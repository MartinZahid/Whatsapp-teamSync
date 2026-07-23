// WebSocket Server for WhatsApp Team Sync + Metrics Dashboard

import { WebSocketServer, WebSocket } from 'ws'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { RoomManager } from './rooms.js'
import { initDatabase, insertEvent, queryDailyStats, queryPeakHours, queryTopAgents, querySessions, exportJSON } from './database.js'
import { WSMessage, isAttendingMessage, isPausedMessage, isAvailableMessage, isOfflineMessage, ErrorMessage } from './types.js'
import { fileURLToPath } from 'url'

const PORT = Number(process.env.PORT) || 3001
const HEARTBEAT_INTERVAL = 30000
const __dirname = join(fileURLToPath(import.meta.url), '..')

const roomManager = new RoomManager()

// --- MIME types for static files ---
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
}

// --- HTTP server for dashboard ---
const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const path = url.pathname

  // API routes
  if (path === '/api/metrics') {
    const days = Math.min(parseInt(url.searchParams.get('days') || '7'), 90)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      daily: queryDailyStats(days),
      peakHours: queryPeakHours(days),
      topAgents: queryTopAgents(days)
    }))
    return
  }

  if (path === '/api/agents') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(roomManager.getAllAgents()))
    return
  }

  if (path === '/api/sessions') {
    const days = Math.min(parseInt(url.searchParams.get('days') || '7'), 90)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(querySessions(days)))
    return
  }

  if (path === '/api/export') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="metrics-export.json"'
    })
    res.end(exportJSON())
    return
  }

  // Serve static files from server/public/
  let filePath = join(__dirname, '..', 'public', path === '/' ? 'dashboard.html' : path)
  if (!existsSync(filePath)) {
    filePath = join(__dirname, '..', 'public', 'dashboard.html')
  }

  try {
    const content = readFileSync(filePath)
    const ext = extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(content)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }
})

// --- WebSocket attached to HTTP server ---
const wss = new WebSocketServer({ server: httpServer })

console.log(`[Server] Starting HTTP + WebSocket server on port ${PORT}...`)

// Heartbeat interval
setInterval(() => {
  roomManager.checkHeartbeats()
}, HEARTBEAT_INTERVAL)

wss.on('connection', (ws: WebSocket) => {
  let agentId: string | null = null
  let isAuthenticated = false

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'WELCOME',
    message: 'Connected to WhatsApp Team Sync server',
    protocol: '1.0.0'
  }))

  ws.on('message', (data: Buffer) => {
    try {
      const message: WSMessage = JSON.parse(data.toString())

      // First message must be authentication (ATTENDING with agent name)
      if (!isAuthenticated) {
        if (isAttendingMessage(message) && message.agent) {
          agentId = roomManager.register(ws, message.agent)
          isAuthenticated = true

          // Send initial state
          roomManager.sendInitialState(agentId)
        } else {
          const error: ErrorMessage = {
            type: 'ERROR',
            code: 'AUTH_REQUIRED',
            message: 'First message must include agent name'
          }
          ws.send(JSON.stringify(error))
        }
        return
      }

      // Process subsequent messages
      if (agentId) {
        roomManager.handleMessage(agentId, message)
      }
    } catch (error) {
      console.error('[Server] Error parsing message:', error)
      const errorMsg: ErrorMessage = {
        type: 'ERROR',
        code: 'PARSE_ERROR',
        message: 'Invalid message format'
      }
      ws.send(JSON.stringify(errorMsg))
    }
  })

  ws.on('close', () => {
    if (agentId) {
      roomManager.disconnect(agentId)
    }
  })

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error)
  })

  // Send ping every 30 seconds
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    } else {
      clearInterval(pingInterval)
    }
  }, 30000)

  ws.on('close', () => {
    clearInterval(pingInterval)
  })
})

wss.on('error', (error) => {
  console.error('[Server] Server error:', error)
})

// Graceful shutdown
function shutdown() {
  console.log('[Server] Shutting down...')
  wss.close(() => httpServer.close(() => {
    console.log('[Server] Server closed')
    process.exit(0)
  }))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Initialize DB then start
initDatabase().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`[Server] Dashboard: http://localhost:${PORT}`)
  })
}).catch(err => {
  console.error('[Server] Failed to initialize database:', err)
  process.exit(1)
})
