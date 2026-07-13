// Background Service Worker - WebSocket connection and agent presence management

// Type definitions
type AgentStatus = 'active' | 'paused' | 'available' | 'offline'

interface AgentConfig {
  agentName: string
  serverUrl: string
}

interface AgentState {
  name: string
  status: AgentStatus
  contact: string | null
  color: string
  lastSeen: number
  tabId?: number
}

interface ClientToServerMessage {
  type: 'ATTENDING' | 'PAUSED' | 'AVAILABLE' | 'HEARTBEAT'
  agent: string
  contact?: string
  status?: AgentStatus
  reason?: string
}

interface ServerToClientMessage {
  type: 'PRESENCE_UPDATE' | 'SERVER_INFO' | 'ERROR' | 'WELCOME'
  agents?: Array<{ id: string; name: string; status: AgentStatus; contact: string | null; color: string; lastSeen: number }>
  version?: string
  message?: string
  code?: string
}

type WSMessage = ClientToServerMessage | ServerToClientMessage

const STORAGE_KEY = 'wts_agent_config'
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY = 1000
const HEARTBEAT_INTERVAL = 30000

class BackgroundManager {
  private ws: WebSocket | null = null
  private config: AgentConfig | null = null
  private agents = new Map<string, AgentState>()
  private currentTabId: number | null = null
  private reconnectAttempts = 0
  private isIntentionallyClosed = false
  private heartbeatTimer: number | null = null

  constructor() {
    this.init()
  }

  private async init(): Promise<void> {
    // Load saved config
    await this.loadConfig()

    // Set up message listener
    chrome.runtime.onMessage.addListener(this.handleMessage.bind(this))

    // Set up tab tracking
    chrome.tabs.onActivated.addListener(({ tabId }) => {
      this.currentTabId = tabId
    })

    chrome.tabs.onRemoved.addListener((tabId) => {
      if (this.currentTabId === tabId) {
        this.currentTabId = null
      }
    })

    // Auto-connect if config exists
    if (this.config) {
      this.connect()
    }

    console.log('[WTS] Background service worker initialized')
  }

  private async loadConfig(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY)
      if (result[STORAGE_KEY]) {
        this.config = result[STORAGE_KEY]
      }
    } catch (error) {
      console.error('[WTS] Error loading config:', error)
    }
  }

  private async saveConfig(): Promise<void> {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: this.config })
    } catch (error) {
      console.error('[WTS] Error saving config:', error)
    }
  }

  private connect(): void {
    if (!this.config) return
    // Don't create duplicate connections
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return

    const url = this.config.serverUrl || 'ws://localhost:3001'

    try {
      this.ws = new WebSocket(url)
      this.ws.onopen = () => this.onOpen()
      this.ws.onmessage = (event) => this.onMessage(event)
      this.ws.onerror = (error) => this.onError(error)
      this.ws.onclose = () => this.onClose()
    } catch (error) {
      console.error('[WTS] WebSocket connection error:', error)
      this.scheduleReconnect()
    }
  }

  private onOpen(): void {
    console.log('[WTS] Connected to server')
    this.reconnectAttempts = 0
    this.isIntentionallyClosed = false
    this.startHeartbeat()
    this.broadcastToContent({ type: 'CONNECTION_STATUS', connected: true })

    // Send initial connection
    this.send({
      type: 'ATTENDING',
      agent: this.config!.agentName
    })
  }

  private onMessage(event: MessageEvent): void {
    try {
      const message: ServerToClientMessage = JSON.parse(event.data)
      this.handleServerMessage(message)
    } catch (error) {
      console.error('[WTS] Error parsing server message:', error)
    }
  }

  private onError(error: Event): void {
    console.error('[WTS] WebSocket error:', error)
  }

  private onClose(): void {
    console.log('[WTS] WebSocket closed')
    this.stopHeartbeat()
    this.broadcastToContent({ type: 'CONNECTION_STATUS', connected: false })

    if (!this.isIntentionallyClosed) {
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[WTS] Max reconnect attempts reached')
      return
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      30000
    )

    this.reconnectAttempts++
    console.log(`[WTS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    setTimeout(() => {
      if (!this.isIntentionallyClosed) {
        this.connect()
      }
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && this.config) {
        this.send({
          type: 'HEARTBEAT',
          agent: this.config.agentName
        })
      }
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private handleServerMessage(message: ServerToClientMessage): void {
    switch (message.type) {
      case 'PRESENCE_UPDATE':
        this.handlePresenceUpdate(message)
        break
      case 'SERVER_INFO':
        this.handleServerInfo(message)
        break
      case 'ERROR':
        console.error('[WTS] Server error:', message.message)
        break
    }
  }

  private handlePresenceUpdate(message: ServerToClientMessage & { agents: any[] }): void {
    if (!message.agents) return

    const serverIds = new Set<string>()

    for (const agent of message.agents) {
      serverIds.add(agent.id)

      const existing = this.agents.get(agent.id) || {
        name: agent.name,
        status: agent.status,
        contact: agent.contact,
        color: agent.color,
        lastSeen: agent.lastSeen,
        tabId: this.currentTabId || undefined
      }

      this.agents.set(agent.id, {
        ...existing,
        status: agent.status,
        contact: agent.contact,
        color: agent.color,
        lastSeen: agent.lastSeen
      })
    }

    // Remove agents no longer tracked by server (prevents ghost accumulation)
    for (const [id] of this.agents) {
      if (!serverIds.has(id)) {
        this.agents.delete(id)
      }
    }

    // Broadcast to content scripts
    const agentsArray = Array.from(this.agents.values()).map(a => ({
      id: a.name,
      name: a.name,
      status: a.status,
      contact: a.contact,
      color: a.color
    }))

    this.broadcastToContent({
      type: 'PRESENCE_UPDATE',
      agents: agentsArray
    })
  }

  private handleServerInfo(message: ServerToClientMessage & { agents: any[] }): void {
    if (message.agents) {
      this.handlePresenceUpdate({ type: 'PRESENCE_UPDATE', agents: message.agents })
    }
  }

  private handleMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void
  ): boolean {
    switch (message.type) {
      case 'CONNECT':
        this.handleConnect(message.config)
        sendResponse({ success: true })
        break

      case 'ATTENDING':
        this.handleAttending(message.contact)
        sendResponse({ success: true })
        break

      case 'PAUSED':
        this.handlePause()
        sendResponse({ success: true })
        break

      case 'RESUMED':
        this.handleResume()
        sendResponse({ success: true })
        break

      case 'AVAILABLE':
        this.handleAvailable()
        sendResponse({ success: true })
        break

      case 'CONTACT_CHANGED':
        this.handleContactChanged(message.contact)
        sendResponse({ success: true })
        break

      case 'UPDATE_SERVER_URL':
        this.handleServerUrlUpdate(message.url)
        sendResponse({ success: true })
        break

      case 'GET_AGENTS':
        sendResponse({ agents: this.getAllAgents() })
        break

      case 'CONTENT_READY':
        this.sendCurrentStateToTab(sender.tab?.id)
        sendResponse({ success: true })
        break

      case 'POPUP_READY':
        this.handlePopupReady(message.agentName)
        sendResponse({ success: true })
        break

      case 'GET_CONNECTION_STATUS':
        sendResponse({
          connected: this.ws?.readyState === WebSocket.OPEN,
          agentName: this.config?.agentName
        })
        break

      case 'DELETE_AGENT':
        this.handleDeleteAgent(message.agentName)
        sendResponse({ success: true })
        break
    }
    return true // Keep channel open for async response
  }

  private handleConnect(config: AgentConfig): void {
    this.config = config
    this.saveConfig()
    this.connect()
  }

  private handleAttending(contact: string): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAgentState(agentName, { status: 'active', contact })

    this.send({
      type: 'ATTENDING',
      agent: agentName,
      contact,
      status: 'active'
    })

    // Broadcast local inmediato para UI instantánea
    this.broadcastToContent({
      type: 'PRESENCE_UPDATE',
      agents: this.getAllAgents()
    })
  }

  private handlePause(): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAgentState(agentName, { status: 'paused', contact: null })

    this.send({
      type: 'PAUSED',
      agent: agentName,
      reason: 'user_paused'
    })

    this.broadcastToContent({
      type: 'PRESENCE_UPDATE',
      agents: this.getAllAgents()
    })
  }

  private handleResume(): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAgentState(agentName, { status: 'available', contact: null })

    this.send({
      type: 'AVAILABLE',
      agent: agentName
    })

    this.broadcastToContent({
      type: 'PRESENCE_UPDATE',
      agents: this.getAllAgents()
    })
  }

  private handleAvailable(): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAgentState(agentName, { status: 'available', contact: null })

    this.send({
      type: 'AVAILABLE',
      agent: agentName
    })

    this.broadcastToContent({
      type: 'PRESENCE_UPDATE',
      agents: this.getAllAgents()
    })
  }

  private handleContactChanged(contact: string | null): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAgentState(agentName, { contact })

    const agent = this.agents.get(agentName)
    // If not paused and has contact, send ATTENDING
    if (agent && agent.status !== 'paused' && contact) {
      this.send({
        type: 'ATTENDING',
        agent: agentName,
        contact: contact || '',
        status: 'active'
      })
    } else if (agent && agent.status !== 'paused' && !contact) {
      // No contact and not paused -> AVAILABLE
      this.send({
        type: 'AVAILABLE',
        agent: agentName
      })
    }

    this.broadcastToContent({
      type: 'PRESENCE_UPDATE',
      agents: this.getAllAgents()
    })
  }

  private handleServerUrlUpdate(url: string): void {
    if (this.config) {
      this.config.serverUrl = url
      this.saveConfig()
      this.disconnect()
      this.connect()
    }
  }

  private updateAgentState(name: string, updates: Partial<AgentState>): void {
    const agent = this.agents.get(name)
    if (agent) {
      this.agents.set(name, { ...agent, ...updates, lastSeen: Date.now() })
    } else {
      this.agents.set(name, {
        name,
        status: updates.status || 'available',
        contact: updates.contact || null,
        color: this.getStatusColor(updates.status || 'available'),
        lastSeen: Date.now(),
        tabId: this.currentTabId || undefined
      })
    }
  }

  private getAllAgents(): any[] {
    return Array.from(this.agents.values()).map(a => ({
      id: a.name,
      name: a.name,
      status: a.status,
      contact: a.contact,
      color: a.color,
      lastSeen: a.lastSeen
    }))
  }

  private getStatusColor(status: AgentStatus): string {
    switch (status) {
      case 'active': return '#EF4444'
      case 'paused': return '#F59E0B'
      case 'available': return '#22C55E'
      case 'offline': return '#9CA3AF'
      default: return '#9CA3AF'
    }
  }

  private send(message: ClientToServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private broadcastToContent(message: any): void {
    // Enviar a todas las pestañas de WhatsApp Web
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {
            // Ignore if content script not ready
          })
        }
      }
    })
  }

  private sendCurrentStateToTab(tabId?: number): void {
    if (!tabId) return

    chrome.tabs.sendMessage(tabId, {
      type: 'PRESENCE_UPDATE',
      agents: this.getAllAgents()
    }).catch(() => {})

    chrome.tabs.sendMessage(tabId, {
      type: 'CONNECTION_STATUS',
      connected: this.ws?.readyState === WebSocket.OPEN
    }).catch(() => {})

    if (this.config?.agentName) {
      chrome.tabs.sendMessage(tabId, {
        type: 'CURRENT_AGENT_NAME',
        name: this.config.agentName
      }).catch(() => {})
    }
  }

  private handlePopupReady(agentName: string): void {
    // If same name and already connected, nothing to do
    if (this.config?.agentName === agentName && this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    // Load server URL from sync storage
    chrome.storage.sync.get('wts_server_url', (result) => {
      const serverUrl = result.wts_server_url || 'ws://localhost:3001'
      
      // If name changed, clean up old agent first
      if (this.config && this.config.agentName !== agentName) {
        const oldName = this.config.agentName
        this.send({ type: 'DELETE_AGENT', agent: oldName })
        this.agents.forEach((agent, id) => {
          if (agent.name === oldName) {
            this.agents.delete(id)
          }
        })
        this.isIntentionallyClosed = true
        this.disconnect()
      }

      this.config = { agentName, serverUrl }
      this.saveConfig()
      this.connect()
    })
  }

  private disconnect(): void {
    this.isIntentionallyClosed = true
    this.stopHeartbeat()

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.broadcastToContent({ type: 'CONNECTION_STATUS', connected: false })
  }

  private handleDeleteAgent(agentName: string): void {
    // Only allow deleting self
    if (this.config?.agentName === agentName) {
      this.agents.delete(agentName)
      this.broadcastToContent({
        type: 'PRESENCE_UPDATE',
        agents: this.getAllAgents()
      })
      
      // Also send to server to remove from other clients
      this.send({
        type: 'OFFLINE',
        agent: agentName
      })
    }
  }
}

// Initialize
new BackgroundManager()