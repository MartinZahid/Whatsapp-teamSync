// SQLite metrics store using sql.js (WASM-based, no native deps)

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

let db: SqlJsDatabase | null = null

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs()
  db = new SQL.Database()

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

  console.log('[DB] SQLite database initialized (in-memory)')
}

function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized')
  return db
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
  const d = getDb()
  const cutoff = Date.now() - days * 86400000
  const stmt = d.prepare('SELECT * FROM chat_sessions WHERE start_time >= ? ORDER BY start_time DESC')
  stmt.bind([cutoff])
  const rows: ChatSessionRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as ChatSessionRow)
  }
  stmt.free()
  return rows
}

// --- Metrics queries ---

export interface AgentDailyStats {
  date: string
  agent: string
  chats: number
  helps: number
}

export function queryDailyStats(days: number): AgentDailyStats[] {
  const d = getDb()
  const cutoff = Date.now() - days * 86400000
  const sql = `
    SELECT
      date(start_time / 1000, 'unixepoch', 'localtime') as date,
      agent,
      COUNT(*) as chats
    FROM chat_sessions
    WHERE start_time >= ?
    GROUP BY date, agent
    ORDER BY date DESC, chats DESC
  `
  const stmt = d.prepare(sql)
  stmt.bind([cutoff])
  const rows: AgentDailyStats[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as AgentDailyStats)
  }
  stmt.free()
  return rows
}

export interface HourlyBuckets {
  hour: number
  count: number
}

export function queryPeakHours(days: number): HourlyBuckets[] {
  const d = getDb()
  const cutoff = Date.now() - days * 86400000
  const sql = `
    SELECT
      CAST(strftime('%H', start_time / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
      COUNT(*) as count
    FROM chat_sessions
    WHERE start_time >= ?
    GROUP BY hour
    ORDER BY count DESC
  `
  const stmt = d.prepare(sql)
  stmt.bind([cutoff])
  const rows: HourlyBuckets[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as HourlyBuckets)
  }
  stmt.free()
  return rows
}

export interface TopAgent {
  agent: string
  chats: number
  total_seconds: number
}

export function queryTopAgents(days: number): TopAgent[] {
  const d = getDb()
  const cutoff = Date.now() - days * 86400000
  const sql = `
    SELECT
      agent,
      COUNT(*) as chats,
      COALESCE(SUM(duration_seconds), 0) as total_seconds
    FROM chat_sessions
    WHERE start_time >= ?
    GROUP BY agent
    ORDER BY total_seconds DESC
  `
  const stmt = d.prepare(sql)
  stmt.bind([cutoff])
  const rows: TopAgent[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as TopAgent)
  }
  stmt.free()
  return rows
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
