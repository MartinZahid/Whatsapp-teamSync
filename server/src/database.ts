// SQLite metrics store using sql.js (WASM-based, no native deps)

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const DB_PATH = process.env.DB_PATH || join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'server', 'data', 'metrics.db')

let db: SqlJsDatabase | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveDatabase()
  }, 5000)
}

function saveDatabase(): void {
  if (!db) return
  try {
    const data = db.export()
    writeFileSync(DB_PATH, Buffer.from(data))
  } catch (err) {
    console.error('[DB] Error saving database:', err)
  }
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()
  mkdirSync(join(DB_PATH, '..'), { recursive: true })

  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
    console.log(`[DB] Loaded existing database from ${DB_PATH}`)
  } else {
    db = new SQL.Database()
    console.log(`[DB] Created new database at ${DB_PATH}`)
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      agent TEXT NOT NULL,
      type TEXT NOT NULL,
      detail TEXT
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent)`)

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      contact TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      duration_seconds INTEGER
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_agent ON chat_sessions(agent)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_start ON chat_sessions(start_time)`)

  // Save on exit
  process.on('beforeExit', saveDatabase)
  process.on('SIGINT', () => { saveDatabase(); process.exit(0) })
  process.on('SIGTERM', () => { saveDatabase(); process.exit(0) })

  console.log(`[DB] Database ready at ${DB_PATH}`)
}

function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized')
  return db
}

const DAY_MS = 86400000

function cutoffDays(days: number): number {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return todayStart - (days - 1) * DAY_MS
}

function queryRows<T>(sql: string, params: any[] = []): T[] {
  const d = getDb()
  const stmt = d.prepare(sql)
  if (params.length) stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as unknown as T)
  stmt.free()
  return rows
}

// Event types
export type EventType =
  | 'chat_start'
  | 'chat_end'
  | 'paused'
  | 'resumed'
  | 'help_request'
  | 'help_cancel'
  | 'connected'
  | 'disconnected'

export function insertEvent(agent: string, type: EventType, detail?: string): void {
  try {
    const d = getDb()
    const stmt = d.prepare('INSERT INTO events (timestamp, agent, type, detail) VALUES (?, ?, ?, ?)')
    stmt.run([Date.now(), agent, type, detail || null])
    stmt.free()
    scheduleSave()
  } catch (err) {
    console.error('[DB] Error inserting event:', err)
  }
}

// --- Chat sessions ---

export function startChatSession(agent: string, contact: string): void {
  try {
    const d = getDb()
    const stmt = d.prepare('INSERT INTO chat_sessions (agent, contact, start_time) VALUES (?, ?, ?)')
    stmt.run([agent, contact, Date.now()])
    stmt.free()
    insertEvent(agent, 'chat_start', contact)
    scheduleSave()
  } catch (err) {
    console.error('[DB] Error starting chat session:', err)
  }
}

export function endChatSession(agent: string): void {
  try {
    const d = getDb()
    const now = Date.now()
    // Find the latest open session for this agent
    const stmt = d.prepare('SELECT id, start_time, contact FROM chat_sessions WHERE agent = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1')
    stmt.bind([agent])
    let session: { id: number; start_time: number; contact: string } | null = null
    if (stmt.step()) {
      session = stmt.getAsObject() as { id: number; start_time: number; contact: string }
    }
    stmt.free()

    if (session) {
      const duration = Math.round((now - session.start_time) / 1000)
      const update = d.prepare('UPDATE chat_sessions SET end_time = ?, duration_seconds = ? WHERE id = ?')
      update.run([now, duration, session.id])
      update.free()
      insertEvent(agent, 'chat_end', `${session.contact}|${duration}s`)
      scheduleSave()
    }
  } catch (err) {
    console.error('[DB] Error ending chat session:', err)
  }
}

export interface ChatSessionRow {
  id: number
  agent: string
  contact: string
  start_time: number
  end_time: number | null
  duration_seconds: number | null
}

export function querySessions(days: number): ChatSessionRow[] {
  return queryRows<ChatSessionRow>('SELECT * FROM chat_sessions WHERE start_time >= ? ORDER BY start_time DESC', [cutoffDays(days)])
}

// --- Metrics queries ---

export interface AgentDailyStats {
  date: string
  agent: string
  total_seconds: number
}

export function queryDailyStats(days: number): AgentDailyStats[] {
  const cutoff = cutoffDays(days)
  return queryRows<AgentDailyStats>(`
    SELECT
      date(start_time / 1000, 'unixepoch', 'localtime') as date,
      agent,
      COALESCE(SUM(duration_seconds), 0) as total_seconds
    FROM chat_sessions
    WHERE start_time >= ?
    GROUP BY date, agent
    ORDER BY date DESC, total_seconds DESC
  `, [cutoff])
}

export interface HourlyBuckets {
  hour: number
  total_seconds: number
}

export function queryPeakHours(days: number): HourlyBuckets[] {
  const cutoff = cutoffDays(days)
  return queryRows<HourlyBuckets>(`
    SELECT
      CAST(strftime('%H', start_time / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
      COALESCE(SUM(duration_seconds), 0) as total_seconds
    FROM chat_sessions
    WHERE start_time >= ?
    GROUP BY hour
    ORDER BY total_seconds DESC
  `, [cutoff])
}

export interface TopAgent {
  agent: string
  contact: string
  total_seconds: number
}

export function queryTopAgents(days: number): TopAgent[] {
  const cutoff = cutoffDays(days)
  return queryRows<TopAgent>(`
    SELECT
      agent,
      contact,
      COALESCE(SUM(duration_seconds), 0) as total_seconds
    FROM chat_sessions
    WHERE start_time >= ?
    GROUP BY agent, contact
    ORDER BY total_seconds DESC
  `, [cutoff])
}

export function exportJSON(): string {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM chat_sessions ORDER BY start_time')
  const rows: ChatSessionRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as ChatSessionRow)
  }
  stmt.free()
  return JSON.stringify(rows, null, 2)
}
