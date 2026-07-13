// Content script entry point - Initializes all components

import './styles.css'
import { DomObserver } from './dom-observer'
import { ContactDetector } from './contact-detector'
import { FloatingPanel } from './floating-panel'

interface AgentConfig {
  agentName: string
  serverUrl: string
}

class WhatsAppTeamSync {
  private domObserver: DomObserver
  private contactDetector: ContactDetector
  private floatingPanel: FloatingPanel
  private currentContact: string | null = null
  private isPaused = false
  private config: AgentConfig | null = null
  private currentAgentName: string | null = null

  constructor() {
    this.domObserver = new DomObserver()
    this.contactDetector = new ContactDetector()
    this.floatingPanel = new FloatingPanel()

    this.init()
  }

  private async init(): Promise<void> {
    // Wait for WhatsApp Web to be fully loaded
    await this.waitForWhatsAppReady()

    this.setupEventListeners()
    this.notifyBackgroundReady()

    // Get current agent name from background
    this.requestAgentName()
  }

  private async waitForWhatsAppReady(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const chatList = document.querySelector('div[data-testid="chat-list"]')
        if (chatList) {
          resolve()
        } else {
          requestAnimationFrame(check)
        }
      }
      check()
    })
  }

  private setupEventListeners(): void {
    // Listen for chat selection changes
    this.domObserver.onChatSelect(async (event) => {
      await this.onChatSelected(event.contactName, event.chatElement)
    })

    // Listen for chat deselection (when clicking away from a chat)
    this.domObserver.onChatDeselect(() => {
      this.onChatDeselected()
    })

    // Listen for contact changes in active conversation
    this.contactDetector.startObserving((contact) => {
      if (contact !== this.currentContact) {
        this.currentContact = contact
        this.updateBackgroundContact(contact)
      }
    })

    // Listen for messages from background
    chrome.runtime.onMessage.addListener((message) => this.handleBackgroundMessage(message))
  }

  private async onChatSelected(contactName: string | null, chatElement: HTMLElement): Promise<void> {
    if (!contactName) {
      contactName = await this.contactDetector.detectCurrentContact()
    }

    if (contactName) {
      this.currentContact = contactName
      this.updateBackgroundContact(contactName)
    }
  }

  private onChatDeselected(): void {
    this.currentContact = null
    this.updateBackgroundContact(null)
  }

  private updateBackgroundContact(contact: string | null): void {
    chrome.runtime.sendMessage({
      type: 'CONTACT_CHANGED',
      contact
    })
  }

  private handleBackgroundMessage(message: any): void {
    switch (message.type) {
      case 'PRESENCE_UPDATE':
        this.floatingPanel.updateAgents(message.agents)
        break
      case 'CONNECTION_STATUS':
        this.floatingPanel.updateServerStatus(message.connected)
        break
      case 'AGENT_STATUS':
        this.isPaused = message.status === 'paused'
        this.floatingPanel.updateCurrentUserStatus(message.status)
        break
      case 'CURRENT_AGENT_NAME':
        this.currentAgentName = message.name
        this.config = { agentName: message.name, serverUrl: '' }
        break
      case 'CONFIG':
        this.config = message.config
        break
    }
  }

  private notifyBackgroundReady(): void {
    chrome.runtime.sendMessage({
      type: 'CONTENT_READY',
      url: location.href
    })
  }

  private requestAgentName(): void {
    chrome.runtime.sendMessage({ type: 'GET_AGENT_NAME' })
  }
}

// Initialize when document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new WhatsAppTeamSync())
} else {
  new WhatsAppTeamSync()
}

export { WhatsAppTeamSync }