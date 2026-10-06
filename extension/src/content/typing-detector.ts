// Typing Detector - Watches the WhatsApp composer and reports typing state.
// Only the boolean (typing / not typing) is ever sent, never the message text.

const TIMING = {
  IDLE_MS: 3000, // report "not typing" after this much inactivity
  REFRESH_MS: 2000, // re-assert "typing" at most this often while active
  WATCHDOG_MS: 2000 // re-anchor to the composer after re-renders
} as const

const COMPOSER_SELECTORS = [
  'footer div[contenteditable="true"][data-testid="conversation-compose-box-input"]',
  'footer div[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]'
]

export class TypingDetector {
  private composer: HTMLElement | null = null
  private inputHandler: (() => void) | null = null
  private watchdog: number | null = null
  private idleTimer: number | null = null
  private isTyping = false
  private lastSentAt = 0
  private currentContact: string | null = null
  private onTypingChange: ((contact: string, typing: boolean) => void) | null = null

  constructor() {
    this.watchdog = window.setInterval(() => this.reanchor(), TIMING.WATCHDOG_MS)
  }

  onTyping(callback: (contact: string, typing: boolean) => void): void {
    this.onTypingChange = callback
  }

  setContact(contact: string | null): void {
    if (contact === this.currentContact) return
    // Switching chats cancels any typing on the previous contact
    this.stopTyping()
    this.currentContact = contact
  }

  private getComposer(): HTMLElement | null {
    for (const selector of COMPOSER_SELECTORS) {
      const el = document.querySelector(selector)
      if (el instanceof HTMLElement) return el
    }
    return null
  }

  private reanchor(): void {
    const composer = this.getComposer()
    if (!composer) return
    if (composer !== this.composer || !this.composer.isConnected) {
      this.attach(composer)
    }
  }

  private attach(composer: HTMLElement): void {
    this.detachListeners()
    this.composer = composer
    this.inputHandler = () => this.handleInput()
    composer.addEventListener('input', this.inputHandler)
    composer.addEventListener('beforeinput', this.inputHandler)
  }

  private detachListeners(): void {
    if (this.composer && this.inputHandler) {
      this.composer.removeEventListener('input', this.inputHandler)
      this.composer.removeEventListener('beforeinput', this.inputHandler)
    }
    this.inputHandler = null
  }

  private handleInput(): void {
    const text = this.composer?.textContent || ''
    if (text.length > 0) {
      const now = Date.now()
      if (!this.isTyping || now - this.lastSentAt > TIMING.REFRESH_MS) {
        this.isTyping = true
        this.lastSentAt = now
        this.emit(true)
      }
      this.resetIdleTimer()
    } else {
      this.stopTyping()
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = window.setTimeout(() => this.stopTyping(), TIMING.IDLE_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private stopTyping(): void {
    this.clearIdleTimer()
    const wasTyping = this.isTyping
    this.isTyping = false
    if (wasTyping) this.emit(false)
  }

  private emit(typing: boolean): void {
    if (!this.currentContact) return
    this.onTypingChange?.(this.currentContact, typing)
  }
}
