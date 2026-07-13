// DOM Observer - Detects chat selection changes in WhatsApp Web

interface ChatSelectEvent {
  type: 'chat-selected'
  contactName: string | null
  chatElement: HTMLElement
}

type ChatSelectCallback = (event: ChatSelectEvent) => void
type ChatDeselectCallback = () => void

export class DomObserver {
  private observer: MutationObserver | null = null
  private selectCallbacks: ChatSelectCallback[] = []
  private deselectCallbacks: ChatDeselectCallback[] = []
  private lastSelectedChat: HTMLElement | null = null
  private debounceTimer: number | null = null
  private isObserving = false

  private readonly CHAT_LIST_SELECTOR = 'div[data-testid="chat-list"]'
  private readonly CHAT_ITEM_SELECTOR = 'div[data-testid="cell-frame-container"]'

  constructor() {
    this.init()
  }

  private init(): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.startObserving())
    } else {
      this.startObserving()
    }

    this.observeUrlChanges()
  }

  private startObserving(): void {
    const chatList = document.querySelector(this.CHAT_LIST_SELECTOR)
    if (!chatList) {
      setTimeout(() => this.startObserving(), 1000)
      return
    }

    this.observer = new MutationObserver((mutations) => this.handleMutations(mutations))
    this.observer.observe(chatList, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'tabindex', 'class', 'data-testid']
    })

    this.isObserving = true
    console.log('[WTS] DOM Observer started')

    this.addClickListeners(chatList as HTMLElement)
  }

  private handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) {
        const target = mutation.target
        const chatItem = target.closest(this.CHAT_ITEM_SELECTOR) as HTMLElement

        if (chatItem && this.isChatSelected(chatItem)) {
          this.handleChatSelection(chatItem)
          return
        }
      }

      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            const chatItem = node.closest?.(this.CHAT_ITEM_SELECTOR) as HTMLElement
            if (chatItem && this.isChatSelected(chatItem)) {
              this.handleChatSelection(chatItem)
              return
            }
          }
        }
      }
    }

    this.scheduleDeselectionCheck()
  }

  // Debounce deselection: only fire when no chat is selected for 300ms
  private deselectionTimer: number | null = null

  private scheduleDeselectionCheck(): void {
    if (this.deselectionTimer) {
      clearTimeout(this.deselectionTimer)
    }
    this.deselectionTimer = window.setTimeout(() => {
      this.deselectionTimer = null
      if (!this.lastSelectedChat) return

      const stillSelected = document.querySelector(
        `${this.CHAT_ITEM_SELECTOR}[aria-selected="true"], ${this.CHAT_ITEM_SELECTOR}[tabindex="0"]`
      )
      if (!stillSelected) {
        // Double-check: is there a conversation panel visible?
        const panel = document.querySelector('div[data-testid="conversation-panel-wrapper"]')
        if (!panel) {
          this.handleChatDeselection()
        }
      }
    }, 300)
  }

  private isChatSelected(element: HTMLElement): boolean {
    return element.getAttribute('aria-selected') === 'true' ||
           element.hasAttribute('data-selected') ||
           element.classList.contains('selected') ||
           element.getAttribute('tabindex') === '0'
  }

  private handleChatSelection(chatElement: HTMLElement): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    if (this.lastSelectedChat === chatElement) return

    this.debounceTimer = window.setTimeout(() => {
      this.lastSelectedChat = chatElement
      this.emitChatSelected(chatElement)
    }, 100)
  }

  private handleChatDeselection(): void {
    if (this.lastSelectedChat) {
      this.lastSelectedChat = null
      this.emitChatDeselected()
    }
  }

  private emitChatSelected(chatElement: HTMLElement): void {
    const contactName = this.extractContactNameFromChatItem(chatElement)

    const event: ChatSelectEvent = {
      type: 'chat-selected',
      contactName,
      chatElement
    }

    for (const callback of this.selectCallbacks) {
      try {
        callback(event)
      } catch (error) {
        console.error('[WTS] Error in chat select callback:', error)
      }
    }
  }

  private emitChatDeselected(): void {
    for (const callback of this.deselectCallbacks) {
      try {
        callback()
      } catch (error) {
        console.error('[WTS] Error in chat deselect callback:', error)
      }
    }
  }

  private extractContactNameFromChatItem(chatElement: HTMLElement): string | null {
    const selectors = [
      'span[data-testid="cell-frame-title"]',
      'span[dir="auto"][title]',
      'div[data-testid="cell-frame-title"]',
      'span._2wUmf',
      'span[title]'
    ]

    for (const selector of selectors) {
      const el = chatElement.querySelector(selector)
      if (el) {
        const name = el.textContent?.trim() || el.getAttribute('title')?.trim()
        if (name) return name
      }
    }

    return null
  }

  private addClickListeners(chatList: HTMLElement): void {
    chatList.addEventListener('click', (e) => {
      const chatItem = (e.target as HTMLElement).closest(this.CHAT_ITEM_SELECTOR) as HTMLElement
      if (chatItem) {
        setTimeout(() => this.handleChatSelection(chatItem), 50)
      }
    }, true)
  }

  private observeUrlChanges(): void {
    let lastUrl = location.href
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href
        console.log('[WTS] URL changed, re-initializing observer')
        this.stopObserving()
        setTimeout(() => this.startObserving(), 500)
      }
    }).observe(document, { subtree: true, childList: true })
  }

  public restart(): void {
    this.stopObserving()
    setTimeout(() => this.startObserving(), 500)
  }

  public stopObserving(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.deselectionTimer) {
      clearTimeout(this.deselectionTimer)
      this.deselectionTimer = null
    }
    this.isObserving = false
  }

  public onChatSelect(callback: ChatSelectCallback): () => void {
    this.selectCallbacks.push(callback)
    return () => {
      const index = this.selectCallbacks.indexOf(callback)
      if (index > -1) this.selectCallbacks.splice(index, 1)
    }
  }

  public onChatDeselect(callback: ChatDeselectCallback): () => void {
    this.deselectCallbacks.push(callback)
    return () => {
      const index = this.deselectCallbacks.indexOf(callback)
      if (index > -1) this.deselectCallbacks.splice(index, 1)
    }
  }

  public isActive(): boolean {
    return this.isObserving
  }
}