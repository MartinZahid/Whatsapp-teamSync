// Content script entry point - Initializes all components

import type { Agent, AgentConfig, AgentStatus } from '@shared/types.js'
import './styles.css'
import { DomObserver } from './dom-observer'
import { ContactDetector } from './contact-detector'
import { FloatingPanel } from './floating-panel'
import { TypingDetector } from './typing-detector'

type ContentBackgroundMessage =
  | { type: 'PRESENCE_UPDATE'; agents: Agent[] }
  | { type: 'CONNECTION_STATUS'; connected: boolean }
  | { type: 'AGENT_STATUS'; status: AgentStatus }
  | { type: 'CURRENT_AGENT_NAME'; name: string }
  | { type: 'CONFIG'; config: AgentConfig }
  | { type: 'DUPLICATE_ALERT'; contact: string; ownerName: string; isOwner: boolean; others: string[] }
  | { type: 'DUPLICATE_CLEAR'; contact: string }

const ORIGINAL_TITLE = document.title
const BLINK_TITLE = 'Chat ocupado'

class WhatsAppTeamSync {
  private domObserver: DomObserver
  private contactDetector: ContactDetector
  private floatingPanel: FloatingPanel
  private typingDetector: TypingDetector
  private currentContact: string | null = null
  private isPaused = false
  private config: AgentConfig | null = null
  private currentAgentName: string | null = null
  private titleBlinkTimer: number | null = null
  private alertContact: string | null = null

  constructor() {
    this.domObserver = new DomObserver()
    this.contactDetector = new ContactDetector()
    this.floatingPanel = new FloatingPanel()
    this.typingDetector = new TypingDetector()

    this.typingDetector.onTyping((contact, typing) => this.sendTyping(contact, typing))
    this.floatingPanel.onClaimChat((contact) => this.sendClaimChat(contact))
    this.floatingPanel.onYieldChat(() => this.updateBackgroundContact(null))

    this.init()
  }

  private async init(): Promise<void> {
    await this.waitForWhatsAppReady()

    this.setupEventListeners()
    this.setupResumeListeners()
    this.notifyBackgroundReady()

    this.requestAgentName()
  }

  // When the tab resumes (e.g. after suspending the computer), WhatsApp
  // re-renders the DOM and may replace the observed nodes. Re-anchor the
  // observers and re-sync the current contact with the background script.
  private setupResumeListeners(): void {
    const onResume = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return

      this.domObserver.restart()

      const contact = await this.contactDetector.detectCurrentContact()
      this.setCurrentContact(contact)

      this.notifyBackgroundReady()
    }

    document.addEventListener('visibilitychange', () => onResume())
    window.addEventListener('focus', () => onResume())
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
    this.domObserver.onChatSelect(async (event) => {
      await this.onChatSelected(event.contactName, event.chatElement)
    })

    this.domObserver.onChatDeselect(() => {
      this.onChatDeselected()
    })

    this.contactDetector.startObserving((contact) => {
      this.setCurrentContact(contact)
    })

    chrome.runtime.onMessage.addListener((message) => this.handleBackgroundMessage(message))
  }

  private async onChatSelected(contactName: string | null, chatElement: HTMLElement): Promise<void> {
    if (!contactName) {
      contactName = await this.contactDetector.detectCurrentContact()
    }

    if (contactName) {
      this.setCurrentContact(contactName)
    }
  }

  private onChatDeselected(): void {
    this.setCurrentContact(null)
  }

  private setCurrentContact(contact: string | null): void {
    if (contact === this.currentContact) return
    this.currentContact = contact
    this.typingDetector.setContact(contact)
    this.updateBackgroundContact(contact)
  }

  private sendTyping(contact: string, typing: boolean): void {
    chrome.runtime.sendMessage({
      type: 'TYPING',
      contact,
      typing
    }).catch(() => {})
  }

  private sendClaimChat(contact: string): void {
    chrome.runtime.sendMessage({
      type: 'CLAIM_CHAT',
      contact
    }).catch(() => {})
  }

  private updateBackgroundContact(contact: string | null): void {
    chrome.runtime.sendMessage({
      type: 'CONTACT_CHANGED',
      contact
    }).catch(() => {})
  }

  private handleBackgroundMessage(message: ContentBackgroundMessage): void {
    switch (message.type) {
      case 'PRESENCE_UPDATE':
        this.floatingPanel.updateAgents(message.agents)
        break
      case 'CONNECTION_STATUS':
        this.floatingPanel.updateServerStatus(message.connected)
        if (message.connected) {
          // Re-sync current contact on (re)connection so the server recovers
          // the agent's active chat after a service worker restart.
          this.updateBackgroundContact(this.currentContact)
        }
        break
      case 'AGENT_STATUS':
        this.isPaused = message.status === 'paused'
        this.floatingPanel.updateCurrentUserStatus(message.status)
        this.floatingPanel.setPaused(this.isPaused)
        break
      case 'CURRENT_AGENT_NAME':
        this.currentAgentName = message.name
        this.config = { agentName: message.name, serverUrl: '' }
        break
      case 'CONFIG':
        this.config = message.config
        break
      case 'DUPLICATE_ALERT':
        this.alertContact = message.contact
        this.floatingPanel.showDuplicateAlert({
          contact: message.contact,
          ownerName: message.ownerName,
          isOwner: message.isOwner,
          others: message.others
        })
        this.startTitleBlink()
        break
      case 'DUPLICATE_CLEAR':
        this.floatingPanel.clearDuplicateAlert()
        this.stopTitleBlink()
        break
    }
  }

  private startTitleBlink(): void {
    if (this.titleBlinkTimer !== null) return
    let on = false
    this.titleBlinkTimer = window.setInterval(() => {
      document.title = on ? ORIGINAL_TITLE : BLINK_TITLE
      on = !on
    }, 1000)
  }

  private stopTitleBlink(): void {
    if (this.titleBlinkTimer === null) return
    clearInterval(this.titleBlinkTimer)
    this.titleBlinkTimer = null
    document.title = ORIGINAL_TITLE
  }

  private notifyBackgroundReady(): void {
    chrome.runtime.sendMessage({
      type: 'CONTENT_READY',
      url: location.href
    }).catch(() => {})
  }

  private requestAgentName(): void {
    chrome.runtime.sendMessage({ type: 'GET_AGENT_NAME' }).catch(() => {})
  }
}

// Initialize when document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new WhatsAppTeamSync())
} else {
  new WhatsAppTeamSync()
}

export { WhatsAppTeamSync }