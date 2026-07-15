// Background Service Worker - WebSocket connection and agent presence management

import type { Agent, AgentStatus, ClientToServerMessage, ServerToClientMessage } from '@shared/types.js'
import { getStatusColor } from '@shared/types.js'

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
  chatStartTime?: number
  tabId?: number
}

type RuntimeMessage =
  | { type: 'CONNECT'; config: AgentConfig }
  | { type: 'ATTENDING'; contact: string }
  | { type: 'PAUSED' }
  | { type: 'RESUMED' }
  | { type: 'AVAILABLE' }
  | { type: 'CONTACT_CHANGED'; contact: string | null }
  | { type: 'UPDATE_SERVER_URL'; url: string }
  | { type: 'GET_AGENTS' }
  | { type: 'GET_AGENT_NAME' }
  | { type: 'CONTENT_READY' }
  | { type: 'POPUP_READY'; agentName: string }
  | { type: 'GET_CONNECTION_STATUS' }
  | { type: 'DELETE_AGENT'; agentName: string }

type ContentMessage =
  | { type: 'PRESENCE_UPDATE'; agents: Agent[] }
  | { type: 'CONNECTION_STATUS'; connected: boolean }
  | { type: 'AGENT_STATUS'; status: AgentStatus }
  | { type: 'CURRENT_AGENT_NAME'; name: string }
  | { type: 'CONFIG'; config: AgentConfig }

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

    this.send({
      type: 'ATTENDING',
      agent: this.config!.agentName,
      contact: '',
      status: 'active'
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

  private handlePresenceUpdate(message: ServerToClientMessage & { agents: Agent[] }): void {
    if (!message.agents) return

    const activeNames = new Set<string>()
    const now = Date.now()

    for (const agent of message.agents) {
      activeNames.add(agent.name)

      const existing = this.agents.get(agent.name) || {
        name: agent.name,
        status: agent.status,
        contact: agent.contact,
        color: agent.color,
        lastSeen: agent.lastSeen,
        tabId: this.currentTabId || undefined
      }

      let chatStartTime = existing.chatStartTime
      const contact = agent.contact || existing.contact || null
      if (agent.status === 'active' && contact && !chatStartTime) {
        chatStartTime = now
      } else if (agent.status !== 'active') {
        chatStartTime = undefined
      }

      this.agents.set(agent.name, {
        ...existing,
        status: agent.status,
        contact,
        color: agent.color,
        chatStartTime,
        lastSeen: agent.lastSeen
      })
    }

    for (const [name] of this.agents) {
      if (!activeNames.has(name)) {
        this.agents.delete(name)
      }
    }

    const agentsArray: Agent[] = Array.from(this.agents.values()).map(a => ({
      id: a.name,
      name: a.name,
      status: a.status,
      contact: a.contact,
      color: a.color,
      lastSeen: a.lastSeen
    }))

    this.broadcastToContent({
      type: 'PRESENCE_UPDATE',
      agents: agentsArray
    })
  }

  private handleServerInfo(message: ServerToClientMessage & { agents: Agent[] }): void {
    if (message.agents) {
      this.handlePresenceUpdate({ type: 'PRESENCE_UPDATE', agents: message.agents })
    }
  }

  private handleMessage(
    message: RuntimeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: Record<string, unknown>) => void
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

      case 'GET_AGENT_NAME':
        sendResponse({ name: this.config?.agentName || null })
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
    return true
  }

  private handleConnect(config: AgentConfig): void {
    this.config = config
    this.saveConfig()
    this.connect()
  }

  private updateAndBroadcast(updates: Partial<AgentState>, serverMsg: ClientToServerMessage): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAgentState(agentName, updates)
    this.send(serverMsg)
    this.broadcastToContent({
      type: 'PRESENCE_UPDATE',
      agents: this.getAllAgents()
    })
  }

  private handleAttending(contact: string): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAndBroadcast(
      { status: 'active', contact },
      { type: 'ATTENDING', agent: agentName, contact, status: 'active' }
    )
  }

  private handlePause(): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAndBroadcast(
      { status: 'paused', contact: null },
      { type: 'PAUSED', agent: agentName, reason: 'user_paused' }
    )
  }

  private handleResume(): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAndBroadcast(
      { status: 'available', contact: null },
      { type: 'AVAILABLE', agent: agentName }
    )
  }

  private handleAvailable(): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    this.updateAndBroadcast(
      { status: 'available', contact: null },
      { type: 'AVAILABLE', agent: agentName }
    )
  }

  private handleContactChanged(contact: string | null): void {
    const agentName = this.config?.agentName
    if (!agentName) return

    const agent = this.agents.get(agentName)
    if (!agent) {
      this.updateAgentState(agentName, { status: contact ? 'active' : 'available', contact })
      this.broadcastToContent({
        type: 'PRESENCE_UPDATE',
        agents: this.getAllAgents()
      })
    } else if (agent.status !== 'paused' && contact) {
      this.updateAndBroadcast(
        { status: 'active', contact },
        { type: 'ATTENDING', agent: agentName, contact, status: 'active' }
      )
    } else if (agent.status !== 'paused' && !contact) {
      this.updateAndBroadcast(
        { status: 'available', contact: null },
        { type: 'AVAILABLE', agent: agentName }
      )
    } else {
      this.updateAgentState(agentName, { contact })
      this.broadcastToContent({
        type: 'PRESENCE_UPDATE',
        agents: this.getAllAgents()
      })
    }
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
    const now = Date.now()
    const newStatus = updates.status ?? agent?.status
    const newContact = updates.contact ?? agent?.contact

    let chatStartTime = agent?.chatStartTime
    if (newStatus === 'active' && newContact && !chatStartTime) {
      chatStartTime = now
    } else if (newStatus !== 'active' || !newContact) {
      chatStartTime = undefined
    }

    if (agent) {
      this.agents.set(name, { ...agent, ...updates, chatStartTime, lastSeen: now })
    } else {
      this.agents.set(name, {
        name,
        status: updates.status || 'available',
        contact: updates.contact || null,
        color: getStatusColor(updates.status || 'available'),
        chatStartTime,
        lastSeen: now,
        tabId: this.currentTabId || undefined
      })
    }
  }

  private getAllAgents(): Agent[] {
    return Array.from(this.agents.values()).map(a => ({
      id: a.name,
      name: a.name,
      status: a.status,
      contact: a.contact,
      color: a.color,
      lastSeen: a.lastSeen,
      chatStartTime: a.chatStartTime
    } as Agent))
  }

  private send(message: ClientToServerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private broadcastToContent(message: ContentMessage): void {
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
    // También notificar al popup si está abierto
    chrome.runtime.sendMessage(message).catch(() => {})
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
    if (this.config?.agentName === agentName) {
      this.agents.delete(agentName)
      this.broadcastToContent({
        type: 'PRESENCE_UPDATE',
        agents: this.getAllAgents()
      })

      this.send({
        type: 'DELETE_AGENT',
        agent: agentName
      })
    }
  }
}

// Initialize
new BackgroundManager()