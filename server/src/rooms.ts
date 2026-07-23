// Server-side agent registry and presence management

import { WebSocket } from 'ws'
import { Agent, AgentStatus, WSMessage, isAttendingMessage, isPausedMessage, isAvailableMessage, isOfflineMessage, isDeleteAgentMessage, isHeartbeatMessage, isHelpRequestMessage, STATUS_COLORS, PresenceUpdate } from './types.js'

interface ClientConnection {
  ws: import('ws').WebSocket
  agentName: string
  agentId: string
}

const MAX_NAME_LENGTH = 50
const MAX_CONTACT_LENGTH = 200
const MAX_MESSAGE_RATE = 20 // messages per second per connection
const STALE_OFFLINE_MS = 300000 // 5 min, then delete agent entirely

export class RoomManager {
  private agents = new Map<string, Agent>()
  private connections = new Map<string, ClientConnection>()
  private messageId = 0
  private rateCounters = new Map<string, { count: number; resetAt: number }>()

  // Generate unique agent ID
  private generateAgentId(name: string): string {
    return `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  }

  // Register a new agent connection
  register(ws: import('ws').WebSocket, name: string): string {
    // Check if agent with same name already exists
    const existingAgent = Array.from(this.agents.values()).find(a => a.name === name)
    if (existingAgent) {
      // Replace connection first, then close old one
      // (order matters: disconnect handler checks if connection was replaced)
      const oldConn = this.connections.get(existingAgent.id)
      this.connections.set(existingAgent.id, { ws, agentName: name, agentId: existingAgent.id })

      // Close old WS if different (will trigger disconnect, but we check for replacement)
      if (oldConn && oldConn.ws !== ws) {
        try { oldConn.ws.close() } catch {}
      }

      // Reuse existing agent
      existingAgent.status = 'available'
      existingAgent.contact = null
      existingAgent.color = STATUS_COLORS.available
      existingAgent.helpRequested = undefined
      existingAgent.lastSeen = Date.now()

      this.broadcastPresence()

      console.log(`[Server] Agent reconnected: ${name} (${existingAgent.id})`)
      return existingAgent.id
    }

    const agentId = this.generateAgentId(name)
    this.connections.set(agentId, { ws, agentName: name, agentId })

    const agent: Agent = {
      id: agentId,
      name,
      status: 'available',
      contact: null,
      color: STATUS_COLORS.available,
      lastSeen: Date.now()
    }

    this.agents.set(agentId, agent)
    this.broadcastPresence()

    console.log(`[Server] Agent registered: ${name} (${agentId})`)
    return agentId
  }

  // Handle incoming message from agent
  handleMessage(agentId: string, message: WSMessage): void {
    const agent = this.agents.get(agentId)
    if (!agent) return

    // Rate limiting
    const now = Date.now()
    const rateKey = agentId
    const counter = this.rateCounters.get(rateKey)
    if (counter && counter.resetAt > now) {
      counter.count++
      if (counter.count > MAX_MESSAGE_RATE) {
        console.warn(`[Server] Rate limit exceeded for ${agent.name}, dropping message`)
        return
      }
    } else {
      this.rateCounters.set(rateKey, { count: 1, resetAt: now + 1000 })
    }

    // Validate string lengths
    if ('contact' in message && typeof message.contact === 'string' && message.contact.length > MAX_CONTACT_LENGTH) {
      console.warn(`[Server] Contact too long from ${agent.name}, truncating`)
      message.contact = message.contact.slice(0, MAX_CONTACT_LENGTH)
    }
    if ('reason' in message && typeof message.reason === 'string' && message.reason.length > MAX_CONTACT_LENGTH) {
      message.reason = message.reason.slice(0, MAX_CONTACT_LENGTH)
    }

    agent.lastSeen = now

    if (isAttendingMessage(message)) {
      agent.status = 'active'
      agent.contact = message.contact
      agent.color = STATUS_COLORS.active
      agent.helpRequested = undefined
      console.log(`[Server] ${agent.name} attending to: ${message.contact}`)
    } else if (isPausedMessage(message)) {
      agent.status = 'paused'
      agent.contact = null
      agent.color = STATUS_COLORS.paused
      agent.helpRequested = undefined
      console.log(`[Server] ${agent.name} paused: ${message.reason || 'Sin razón'}`)
    } else if (isAvailableMessage(message)) {
      agent.status = 'available'
      agent.contact = null
      agent.color = STATUS_COLORS.available
      agent.helpRequested = undefined
      console.log(`[Server] ${agent.name} available`)
    } else if (isOfflineMessage(message)) {
      agent.status = 'offline'
      agent.contact = null
      agent.color = STATUS_COLORS.offline
      agent.helpRequested = undefined
      console.log(`[Server] ${agent.name} offline`)
    } else if (isDeleteAgentMessage(message)) {
      // Full removal: delete from both Maps
      const deletedAgent = this.agents.get(agentId)
      this.agents.delete(agentId)
      this.connections.delete(agentId)
      this.rateCounters.delete(agentId)
      if (deletedAgent) {
        console.log(`[Server] Agent removed: ${deletedAgent.name}`)
      }
    } else if (isHeartbeatMessage(message)) {
      return // Heartbeat does not change state, no broadcast needed
    } else if (isHelpRequestMessage(message)) {
      agent.helpRequested = message.requesting
      console.log(`[Server] ${agent.name} ${message.requesting ? 'solicita ayuda' : 'cancela ayuda'}`)
    }

    this.broadcastPresence()
  }

  // Handle disconnection
  disconnect(agentId: string): void {
    // Check if a newer connection has already replaced this one
    const currentConn = this.connections.get(agentId)
    if (currentConn && currentConn.ws.readyState === WebSocket.OPEN) {
      // A newer connection is already active — don't mark agent offline
      return
    }

    const agent = this.agents.get(agentId)
    if (agent) {
      console.log(`[Server] Agent disconnected: ${agent.name}`)
      agent.status = 'offline'
      agent.color = STATUS_COLORS.offline
      agent.lastSeen = Date.now()
      this.broadcastPresence()
    }
    this.connections.delete(agentId)
  }

  // Get all agents for initial sync
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values())
  }

  // Broadcast presence update to all connected clients
  private broadcastPresence(): void {
    const agents = this.getAllAgents()
    const message: PresenceUpdate = {
      type: 'PRESENCE_UPDATE',
      agents
    }

    const data = JSON.stringify(message)

    for (const [agentId, conn] of this.connections) {
      if (conn.ws.readyState === WebSocket.OPEN) {
        conn.ws.send(data)
      }
    }
  }

  // Send initial state to newly connected client
  sendInitialState(agentId: string): void {
    const conn = this.connections.get(agentId)
    if (!conn || conn.ws.readyState !== 1) return

    const message = {
      type: 'SERVER_INFO',
      version: '1.0.0',
      agents: this.getAllAgents()
    }

    conn.ws.send(JSON.stringify(message))
  }

  // Heartbeat check
  checkHeartbeats(): void {
    const now = Date.now()
    let changed = false
    for (const [agentId, agent] of this.agents) {
      // Mark as offline if no heartbeat for 60 seconds
      if (now - agent.lastSeen > 60000 && agent.status !== 'offline') {
        agent.status = 'offline'
        agent.color = STATUS_COLORS.offline
        agent.helpRequested = undefined
        console.log(`[Server] Heartbeat timeout for ${agent.name}`)
        changed = true
      }
      // Delete if offline for more than STALE_OFFLINE_MS
      if (agent.status === 'offline' && now - agent.lastSeen > STALE_OFFLINE_MS) {
        this.agents.delete(agentId)
        this.connections.delete(agentId)
        this.rateCounters.delete(agentId)
        console.log(`[Server] Removing stale offline agent: ${agent.name}`)
        changed = true
      }
    }
    if (changed) this.broadcastPresence()
  }
}