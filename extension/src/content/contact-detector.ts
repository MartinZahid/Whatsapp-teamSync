// Contact Detector - Extracts contact name from active WhatsApp Web chat

const TIMING = {
  DOM_STABLE_WAIT_MS: 500,
  PANEL_WATCHDOG_MS: 2000
} as const

export class ContactDetector {
  private readonly CONVERSATION_PANEL_SELECTOR = 'div[data-testid="conversation-panel-wrapper"]'
  private readonly CHAT_TITLE_SELECTOR = 'header span[data-testid="conversation-info-header-chat-title"]'
  private readonly BUSINESS_BADGE_SELECTOR = 'span[data-testid="verified-badge"]'

  private currentContact: string | null = null
  private observer: MutationObserver | null = null
  private pollingTimer: number | null = null
  private onContactChangeCallback: ((contact: string | null) => void) | null = null
  private lastKnownContact: string | null = null
  private waitingForDOM = false
  private observedPanel: HTMLElement | null = null

  constructor() {
    this.init()
  }

  private init(): void {
    // No-op: observer starts when startObserving(callback) is called by index.ts
  }

  async detectCurrentContact(): Promise<string | null> {
    // Wait longer for header to load after chat switch
    await this.waitForStableDOM(TIMING.DOM_STABLE_WAIT_MS)
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

    if (document.readyState === 'loading') {
      if (this.waitingForDOM) return
      this.waitingForDOM = true
      document.addEventListener('DOMContentLoaded', () => {
        this.waitingForDOM = false
        this.startObserving(callback)
      })
      return
    }

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
      this.observedPanel = panel
      this.observer.observe(panel, {
        childList: true,
        subtree: true,
        characterData: true
      })
    }
    this.startPollingForPanel()
  }

  // Lightweight watchdog: keeps re-anchoring the observer if the panel node
  // is replaced by a re-render (e.g. after suspend/resume). Runs at a slow
  // cadence, checking isConnected instead of re-wiring on every mutation.
  private startPollingForPanel(): void {
    if (this.pollingTimer) return

    this.pollingTimer = window.setInterval(() => {
      const panel = document.querySelector(this.CONVERSATION_PANEL_SELECTOR)

      if (!panel) {
        // Panel truly gone — report null contact if we had one
        if (this.currentContact) {
          this.currentContact = null
          this.lastKnownContact = null
          this.onContactChangeCallback?.(null)
        }
        return
      }

      if (this.observer) {
        // Re-anchor observer if it is observing a node no longer in the DOM
        if (!this.observedPanel || !this.observedPanel.isConnected) {
          this.observer.observe(panel, {
            childList: true,
            subtree: true,
            characterData: true
          })
          this.observedPanel = panel

          // Re-detect the current contact once the observer is re-anchored
          const contact = this.extractContactName()
          if (contact && contact !== this.currentContact) {
            this.currentContact = contact
            this.lastKnownContact = contact
            this.onContactChangeCallback?.(contact)
          }
        }
      } else {
        this.observedPanel = panel
      }
    }, TIMING.PANEL_WATCHDOG_MS)
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