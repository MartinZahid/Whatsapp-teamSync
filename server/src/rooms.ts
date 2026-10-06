// Server-side agent registry and presence management

import { WebSocket } from 'ws'
import { Agent, AgentStatus, WSMessage, ServerToClientMessage, isAttendingMessage, isPausedMessage, isAvailableMessage, isOfflineMessage, isDeleteAgentMessage, isHeartbeatMessage, isHelpRequestMessage, isTypingMessage, isClaimChatMessage, STATUS_COLORS, PresenceUpdate } from './types.js'
import { insertEvent, startChatSession, endChatSession } from './database.js'
import { APP_VERSION } from '../../shared/version.js'

interface ClientConnection {
  ws: import('ws').WebSocket
  agentName: string
  agentId: string
}

const MAX_NAME_LENGTH = 50
const MAX_CONTACT_LENGTH = 200
const MAX_MESSAGE_RATE = 20 // messages per second per connection
const HEARTBEAT_TIMEOUT_MS = 60000 // mark offline if no heartbeat for 60s
const STALE_OFFLINE_MS = 300000 // 5 min, then delete agent entirely
const TYPING_TIMEOUT_MS = 6000 // drop stale typing flag if no refresh for 6s

export class RoomManager {
  private agents = new Map<string, Agent>()
  private connections = new Map<string, ClientConnection>()
  private rateCounters = new Map<string, { count: number; resetAt: number }>()
  // contact -> set of agentIds currently typing in that contact
  private typing = new Map<string, Set<string>>()
  // contact -> agentId -> expiry timer for stale typing
  private typingExpiry = new Map<string, Map<string, ReturnType<typeof setTimeout>>>()
  // contacts that currently have an active duplicate conflict
  private duplicateContacts = new Set<string>()
  // contact -> agentId of the current owner
  private contactOwners = new Map<string, string>()

  // Generate unique agent ID
  private generateAgentId(name: string): string {
    return `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  }

  // Register a new agent connection
  register(ws: import('ws').WebSocket, name: string): string {
    if (name.length > MAX_NAME_LENGTH) {
      console.warn(`[Server] Agent name too long (${name.length}), truncating`)
      name = name.slice(0, MAX_NAME_LENGTH)
    }
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
      if (existingAgent.status === 'active') endChatSession(existingAgent.name)
      const oldContact = existingAgent.contact
      this.clearAgentTyping(existingAgent.id)
      if (oldContact) this.evaluateDuplicate(oldContact)
      existingAgent.status = 'available'
      existingAgent.contact = null
      existingAgent.color = STATUS_COLORS.available
      existingAgent.helpRequested = undefined
      existingAgent.lastSeen = Date.now()

      this.broadcastPresence()

      insertEvent(name, 'connected')
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

    insertEvent(name, 'connected')
    console.log(`[Server] Agent registered: ${name} (${agentId})`)
    return agentId
  }

  private setStatus(agent: Agent, status: AgentStatus, contact: string | null = null): void {
    if (agent.status === 'active' && agent.contact !== contact) endChatSession(agent.name)
    agent.status = status
    agent.contact = contact
    agent.color = STATUS_COLORS[status]
    agent.helpRequested = undefined
  }

  // Send a single message to one connected agent
  private sendTo(agentId: string, message: ServerToClientMessage): void {
    const conn = this.connections.get(agentId)
    if (conn && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(message))
    }
  }

  // Agents currently active on a given contact
  private getActiveForContact(contact: string): Agent[] {
    const result: Agent[] = []
    for (const a of this.agents.values()) {
      if (a.status === 'active' && a.contact === contact) result.push(a)
    }
    return result
  }

  private markTyping(agentId: string, contact: string): void {
    let set = this.typing.get(contact)
    if (!set) { set = new Set(); this.typing.set(contact, set) }
    set.add(agentId)

    let timers = this.typingExpiry.get(contact)
    if (!timers) { timers = new Map(); this.typingExpiry.set(contact, timers) }
    const existing = timers.get(agentId)
    if (existing) clearTimeout(existing)
    timers.set(agentId, setTimeout(() => this.unmarkTyping(agentId, contact), TYPING_TIMEOUT_MS))

    this.evaluateDuplicate(contact)
  }

  private unmarkTyping(agentId: string, contact: string): void {
    const set = this.typing.get(contact)
    if (set) {
      set.delete(agentId)
      if (set.size === 0) this.typing.delete(contact)
    }
    this.clearTypingTimer(contact, agentId)
    this.evaluateDuplicate(contact)
  }

  private clearTypingTimer(contact: string, agentId: string): void {
    const timers = this.typingExpiry.get(contact)
    if (!timers) return
    const t = timers.get(agentId)
    if (t) clearTimeout(t)
    timers.delete(agentId)
    if (timers.size === 0) this.typingExpiry.delete(contact)
  }

  // Remove an agent from every typing set (used on pause/offline/switch/disconnect/delete)
  private clearAgentTyping(agentId: string): void {
    const contacts: string[] = []
    for (const [contact, set] of this.typing) {
      if (set.has(agentId)) contacts.push(contact)
    }
    for (const contact of contacts) {
      const set = this.typing.get(contact)
      if (set) {
        set.delete(agentId)
        if (set.size === 0) this.typing.delete(contact)
      }
      this.clearTypingTimer(contact, agentId)
    }
  }

  // Called whenever an agent stops being active on a contact
  private onLeftContact(agentId: string, contact: string | null): void {
    this.clearAgentTyping(agentId)
    if (!contact) return
    // Always release the agent that leaves the contact: by the time the conflict
    // resolves it is no longer "active" on the contact, so resolveDuplicate()
    // would not notify it and its lock overlay would stay stuck.
    if (this.duplicateContacts.has(contact)) {
      this.sendTo(agentId, { type: 'DUPLICATE_CLEAR', contact })
    }
    this.evaluateDuplicate(contact)
    // Drop the owner entry once nobody is active on the contact (avoids growth)
    if (!this.duplicateContacts.has(contact) && this.getActiveForContact(contact).length === 0) {
      this.contactOwners.delete(contact)
    }
  }

  private evaluateDuplicate(contact: string): void {
    const active = this.getActiveForContact(contact)
    const hasConflict = this.duplicateContacts.has(contact)

    if (!hasConflict) {
      const typingSet = this.typing.get(contact)
      if (!typingSet) return
      let typingActive = 0
      for (const id of typingSet) {
        const a = this.agents.get(id)
        if (a && a.status === 'active' && a.contact === contact) typingActive++
      }
      if (typingActive >= 2 && active.length >= 2) {
        this.duplicateContacts.add(contact)
        const ownerId = this.contactOwners.get(contact)
        if (!ownerId || !active.some(a => a.id === ownerId)) {
          this.contactOwners.set(contact, active[0].id)
        }
        const owner = this.agents.get(this.contactOwners.get(contact)!)
        insertEvent(owner?.name || 'desconocido', 'duplicate_alert', contact)
        console.log(`[Server] Duplicate typing detected on "${contact}"`)
        this.broadcastDuplicate(contact, this.contactOwners.get(contact)!)
      }
      return
    }

    // Conflict already active: only resolve when fewer than 2 agents remain
    if (active.length < 2) {
      this.resolveDuplicate(contact)
      return
    }

    // Keep owner valid; reassign and re-notify if the owner left the contact
    const ownerId = this.contactOwners.get(contact)
    if (!ownerId || !active.some(a => a.id === ownerId)) {
      this.contactOwners.set(contact, active[0].id)
      this.broadcastDuplicate(contact, active[0].id)
    }
  }

  private broadcastDuplicate(contact: string, ownerId: string): void {
    const owner = this.agents.get(ownerId)
    const involved = this.getActiveForContact(contact)
    for (const a of involved) {
      const others = involved.filter(x => x.id !== a.id).map(x => x.name)
      this.sendTo(a.id, {
        type: 'DUPLICATE_ALERT',
        contact,
        ownerName: owner ? owner.name : a.name,
        isOwner: a.id === ownerId,
        others
      })
    }
  }

  private resolveDuplicate(contact: string): void {
    this.duplicateContacts.delete(contact)
    this.contactOwners.delete(contact)
    for (const a of this.getActiveForContact(contact)) {
      this.sendTo(a.id, { type: 'DUPLICATE_CLEAR', contact })
    }
  }

  private handleClaim(agentId: string, contact: string): void {
    const agent = this.agents.get(agentId)
    if (!agent || agent.status !== 'active' || agent.contact !== contact) return
    // Claiming only makes sense while a conflict is active on this contact
    if (!this.duplicateContacts.has(contact)) return

    this.contactOwners.set(contact, agentId)
    insertEvent(agent.name, 'chat_claimed', contact)
    console.log(`[Server] ${agent.name} claimed chat: ${contact}`)

    // New owner is released from the lock
    this.sendTo(agentId, { type: 'DUPLICATE_CLEAR', contact })

    // Everyone else stays locked, now under the new owner
    const involved = this.getActiveForContact(contact)
    for (const a of involved) {
      if (a.id === agentId) continue
      const others = involved.filter(x => x.id !== a.id).map(x => x.name)
      this.sendTo(a.id, {
        type: 'DUPLICATE_ALERT',
        contact,
        ownerName: agent.name,
        isOwner: false,
        others
      })
    }
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
      const contactChanged = agent.contact !== message.contact
      const oldContact = agent.contact
      this.setStatus(agent, 'active', message.contact)
      if (contactChanged) {
        startChatSession(agent.name, message.contact)
        this.onLeftContact(agentId, oldContact)
        if (!this.contactOwners.has(message.contact)) this.contactOwners.set(message.contact, agentId)
        this.evaluateDuplicate(message.contact)
        // Re-notify everyone if the contact already has an active conflict
        if (this.duplicateContacts.has(message.contact)) {
          const ownerId = this.contactOwners.get(message.contact)
          if (ownerId) this.broadcastDuplicate(message.contact, ownerId)
        }
      }
      console.log(`[Server] ${agent.name} attending to: ${message.contact}`)
    } else if (isPausedMessage(message)) {
      const oldContact = agent.contact
      this.setStatus(agent, 'paused')
      this.onLeftContact(agentId, oldContact)
      insertEvent(agent.name, 'paused', message.reason)
      console.log(`[Server] ${agent.name} paused: ${message.reason || 'Sin razón'}`)
    } else if (isAvailableMessage(message)) {
      const oldContact = agent.contact
      this.setStatus(agent, 'available')
      this.onLeftContact(agentId, oldContact)
      insertEvent(agent.name, 'resumed')
      console.log(`[Server] ${agent.name} available`)
    } else if (isOfflineMessage(message)) {
      const oldContact = agent.contact
      this.setStatus(agent, 'offline')
      this.onLeftContact(agentId, oldContact)
      insertEvent(agent.name, 'disconnected')
      console.log(`[Server] ${agent.name} offline`)
    } else if (isDeleteAgentMessage(message)) {
      // Full removal: delete from both Maps
      const deletedAgent = this.agents.get(agentId)
      const oldContact = deletedAgent?.contact ?? null
      this.agents.delete(agentId)
      this.connections.delete(agentId)
      this.rateCounters.delete(agentId)
      this.onLeftContact(agentId, oldContact)
      if (deletedAgent) {
        console.log(`[Server] Agent removed: ${deletedAgent.name}`)
      }
    } else if (isHeartbeatMessage(message)) {
      return // Heartbeat does not change state, no broadcast needed
    } else if (isHelpRequestMessage(message)) {
      agent.helpRequested = message.requesting
      insertEvent(agent.name, message.requesting ? 'help_request' : 'help_cancel')
      console.log(`[Server] ${agent.name} ${message.requesting ? 'solicita ayuda' : 'cancela ayuda'}`)
    } else if (isTypingMessage(message)) {
      if (message.typing) {
        if (agent.status === 'active' && agent.contact === message.contact) {
          this.markTyping(agentId, message.contact)
        }
      } else {
        this.unmarkTyping(agentId, message.contact)
      }
      return // Typing does not affect presence, skip broadcast
    } else if (isClaimChatMessage(message)) {
      this.handleClaim(agentId, message.contact)
      return // Claim sends its own targeted messages
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
      const oldContact = agent.contact
      this.setStatus(agent, 'offline')
      agent.lastSeen = Date.now()
      this.onLeftContact(agentId, oldContact)
      insertEvent(agent.name, 'disconnected')
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
      version: APP_VERSION,
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
      if (now - agent.lastSeen > HEARTBEAT_TIMEOUT_MS && agent.status !== 'offline') {
        const oldContact = agent.contact
        this.setStatus(agent, 'offline')
        this.onLeftContact(agentId, oldContact)
        console.log(`[Server] Heartbeat timeout for ${agent.name}`)
        changed = true
      }
      // Delete if offline for more than STALE_OFFLINE_MS
      if (agent.status === 'offline' && now - agent.lastSeen > STALE_OFFLINE_MS) {
        const oldContact = agent.contact
        this.agents.delete(agentId)
        this.connections.delete(agentId)
        this.rateCounters.delete(agentId)
        this.onLeftContact(agentId, oldContact)
        console.log(`[Server] Removing stale offline agent: ${agent.name}`)
        changed = true
      }
    }
    if (changed) this.broadcastPresence()
  }
}