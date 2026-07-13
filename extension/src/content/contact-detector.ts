// Contact Detector - Extracts contact name from active WhatsApp Web chat

export class ContactDetector {
  private readonly CONVERSATION_PANEL_SELECTOR = 'div[data-testid="conversation-panel-wrapper"]'
  private readonly CHAT_TITLE_SELECTOR = 'header span[data-testid="conversation-info-header-chat-title"]'
  private readonly BUSINESS_BADGE_SELECTOR = 'span[data-testid="verified-badge"]'

  private currentContact: string | null = null
  private observer: MutationObserver | null = null
  private pollingTimer: number | null = null
  private onContactChangeCallback: ((contact: string | null) => void) | null = null
  private lastKnownContact: string | null = null // Cache last valid contact

  constructor() {
    this.init()
  }

  private init(): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.startObserving())
    } else {
      this.startObserving()
    }
  }

  async detectCurrentContact(): Promise<string | null> {
    // Wait longer for header to load after chat switch
    await this.waitForStableDOM(500)
    const contact = this.extractContactName()
    if (contact) {
      this.currentContact = contact
      this.lastKnownContact = contact
    } else if (this.currentContact) {
      // Keep last known contact if panel exists but title not loaded yet
      const panel = document.querySelector(this.CONVERSATION_PANEL_SELECTOR)
      if (panel) {
        return this.currentContact
      }
    }
    return this.currentContact
  }

  private extractContactName(): string | null {
    const panel = document.querySelector(this.CONVERSATION_PANEL_SELECTOR)
    if (!panel) return null

    const titleEl = panel.querySelector(this.CHAT_TITLE_SELECTOR)
    if (!titleEl) return null

    const name = titleEl.textContent?.trim()
    if (!name) return null

    // Check for business verified badge
    const businessBadge = panel.querySelector(this.BUSINESS_BADGE_SELECTOR)
    if (businessBadge) {
      return `✓ ${name}`
    }

    return name
  }

  private waitForStableDOM(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  startObserving(callback: (contact: string | null) => void): void {
    this.onContactChangeCallback = callback

    if (this.observer) return

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          const newContact = this.extractContactName()
          if (newContact !== this.currentContact) {
            if (newContact) {
              this.currentContact = newContact
              this.lastKnownContact = newContact
              this.onContactChangeCallback?.(newContact)
            } else {
              // DOM re-render — don't fire null unless panel is truly gone
              const panel = document.querySelector(this.CONVERSATION_PANEL_SELECTOR)
              if (!panel) {
                this.currentContact = null
                this.lastKnownContact = null
                this.onContactChangeCallback?.(null)
              }
            }
          }
        }
      }
    })

    const panel = document.querySelector(this.CONVERSATION_PANEL_SELECTOR)
    if (panel) {
      this.observer.observe(panel, {
        childList: true,
        subtree: true,
        characterData: true
      })
    } else {
      this.startPollingForPanel()
    }
  }

  private startPollingForPanel(): void {
    if (this.pollingTimer) return

    this.pollingTimer = window.setInterval(() => {
      const panel = document.querySelector(this.CONVERSATION_PANEL_SELECTOR)
      if (panel && this.observer) {
        this.observer.observe(panel, {
          childList: true,
          subtree: true,
          characterData: true
        })
        this.stopPolling()
      }
    }, 500)
  }

  stopObserving(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    this.stopPolling()
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  getCurrentContact(): string | null {
    return this.currentContact
  }

  getLastKnownContact(): string | null {
    return this.lastKnownContact
  }
}