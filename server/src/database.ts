// SQLite metrics store using sql.js (WASM-based, no native deps)

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'

let db: SqlJsDatabase | null = null

export async function initDatabase(dbPath?: string): Promise<void> {
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
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent)
  `)

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

export interface EventRow {
  id: number
  timestamp: number
  agent: string
  type: EventType
  detail: string | null
}

export function queryEvents(from: number, to: number): EventRow[] {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM events WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC')
  stmt.bind([from, to])
  const rows: EventRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as EventRow)
  }
  stmt.free()
  return rows
}

export interface AgentDailyStats {
  date: string
  agent: string
  chats: number
  total_seconds: number
  avg_seconds: number
  helps: number
}

export function queryDailyStats(days: number): AgentDailyStats[] {
  const d = getDb()
  const cutoff = Date.now() - days * 86400000
  const sql = `
    SELECT
      date(timestamp / 1000, 'unixepoch') as date,
      agent,
      SUM(CASE WHEN type = 'chat_start' THEN 1 ELSE 0 END) as chats,
      SUM(CASE WHEN type = 'help_request' THEN 1 ELSE 0 END) as helps
    FROM events
    WHERE timestamp >= ?
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
      CAST(strftime('%H', timestamp / 1000, 'unixepoch') AS INTEGER) as hour,
      COUNT(*) as count
    FROM events
    WHERE timestamp >= ? AND type IN ('chat_start', 'help_request')
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
      SUM(CASE WHEN type = 'chat_start' THEN 1 ELSE 0 END) as chats
    FROM events
    WHERE timestamp >= ?
    GROUP BY agent
    ORDER BY chats DESC
    LIMIT 10
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

export function exportJSON(): string {
  const d = getDb()
  const stmt = d.prepare('SELECT * FROM events ORDER BY timestamp')
  const rows: EventRow[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as unknown as EventRow)
  }
  stmt.free()
  return JSON.stringify(rows, null, 2)
}
