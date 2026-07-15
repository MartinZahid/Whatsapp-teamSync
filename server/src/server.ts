// WebSocket Server for WhatsApp Team Sync

import { WebSocketServer, WebSocket } from 'ws'
import { RoomManager } from './rooms.js'
import { WSMessage, isAttendingMessage, isPausedMessage, isAvailableMessage, isOfflineMessage, ServerInfoMessage, ErrorMessage, PresenceUpdate, AgentStatus } from './types.js'

const PORT = process.env.PORT || 3001
const HEARTBEAT_INTERVAL = 30000

const roomManager = new RoomManager()
const wss = new WebSocketServer({ port: Number(PORT) })

console.log(`[Server] WebSocket server started on ws://localhost:${PORT}`)

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
process.on('SIGINT', () => {
  console.log('[Server] Shutting down...')
  wss.close(() => {
    console.log('[Server] Server closed')
    process.exit(0)
  })
})

process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...')
  wss.close(() => {
    console.log('[Server] Server closed')
    process.exit(0)
  })
})