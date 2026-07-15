// Floating Panel - Injected UI showing agent presence

import type { Agent, AgentStatus } from '@shared/types.js'
import { getStatusColor, getStatusLabel, getStatusClass } from '@shared/types.js'
import styles from './floating-panel.css?raw'

interface AgentDisplay extends Agent {
  isCurrentUser: boolean
}

export class FloatingPanel {
  private shadowRoot: ShadowRoot | null = null
  private host: HTMLElement | null = null
  private panel: HTMLElement | null = null
  private agentsList: HTMLElement | null = null
  private toggleBtn: HTMLButtonElement | null = null
  private collapsedBadge: HTMLElement | null = null
  private isCollapsed = false
  private currentAgentName: string | null = null
  private serverConnected = false
  private pauseBtn: HTMLButtonElement | null = null
  private resumeBtn: HTMLButtonElement | null = null
  private isPaused = false
  private timerInterval: number | null = null
  private localChatTimes: Map<string, number> = new Map()
  private chatContacts: Map<string, string | null> = new Map()

  constructor() {
    this.init()
  }

  private init(): void {
    this.host = document.createElement('div')
    this.host.id = 'wts-floating-panel-host'
    this.host.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      pointer-events: none;
    `
    document.body.appendChild(this.host)

    this.shadowRoot = this.host.attachShadow({ mode: 'open' })
    this.injectStyles()
    this.render()
    this.bindEvents()
    this.loadCollapsedState()
  }

  private injectStyles(): void {
    const style = document.createElement('style')
    style.textContent = this.getStyles()
    this.shadowRoot!.appendChild(style)
  }

  private getStyles(): string {
    return styles
  }

  private render(): void {
    if (!this.shadowRoot) return

    this.shadowRoot.innerHTML = `
      <style>${this.getStyles()}</style>
      <div class="wts-panel" id="wts-panel">
        <div class="wts-header">
          <h3>
            <span class="wts-logo">W</span>
            WhatsApp Team Sync
          </h3>
          <button class="wts-toggle" id="wts-toggle" aria-label="Colapsar panel" title="Colapsar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
        </div>
        <div class="wts-agents" id="wts-agents">
          <div class="wts-empty">Cargando agentes...</div>
        </div>
        <div class="wts-actions" id="wts-actions">
          <button class="wts-pause-btn" id="wts-pause-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16"/>
              <rect x="14" y="4" width="4" height="16"/>
            </svg>
            Pausar
          </button>
          <button class="wts-pause-btn wts-resume-btn hidden" id="wts-resume-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Disponible
          </button>
        </div>
        <div class="wts-server-status" id="wts-server-status">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>Conectando al servidor...</span>
        </div>
      </div>
      <button class="wts-collapsed-badge hidden" id="wts-collapsed-badge" aria-label="Expandir panel" title="WhatsApp Team Sync">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
        <span id="wts-badge-count">0</span>
      </button>
    `

    this.panel = this.shadowRoot.getElementById('wts-panel') as HTMLElement
    this.agentsList = this.shadowRoot.getElementById('wts-agents') as HTMLElement
    this.toggleBtn = this.shadowRoot.getElementById('wts-toggle') as HTMLButtonElement
    this.collapsedBadge = this.shadowRoot.getElementById('wts-collapsed-badge') as HTMLElement
    this.pauseBtn = this.shadowRoot.getElementById('wts-pause-btn') as HTMLButtonElement
    this.resumeBtn = this.shadowRoot.getElementById('wts-resume-btn') as HTMLButtonElement
  }

  private bindEvents(): void {
    this.toggleBtn?.addEventListener('click', () => this.toggleCollapse())
    this.collapsedBadge?.addEventListener('click', () => this.toggleCollapse())

    this.pauseBtn?.addEventListener('click', () => {
      this.isPaused = true
      this.pauseBtn?.classList.add('hidden')
      this.resumeBtn?.classList.remove('hidden')
      chrome.runtime.sendMessage({ type: 'PAUSED' })
    })

    this.resumeBtn?.addEventListener('click', () => {
      this.isPaused = false
      this.resumeBtn?.classList.add('hidden')
      this.pauseBtn?.classList.remove('hidden')
      chrome.runtime.sendMessage({ type: 'RESUMED' })
    })

    // Keyboard support
    this.panel?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.collapse()
    })
  }

  private loadCollapsedState(): void {
    try {
      const saved = localStorage.getItem('wts_panel_collapsed')
      if (saved === 'true') {
        this.collapse()
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  private saveCollapsedState(): void {
    try {
      localStorage.setItem('wts_panel_collapsed', this.isCollapsed.toString())
    } catch {
      // Ignore
    }
  }

  toggleCollapse(): void {
    if (this.isCollapsed) {
      this.expand()
    } else {
      this.collapse()
    }
  }

  private expand(): void {
    this.panel?.classList.remove('collapsed')
    this.collapsedBadge?.classList.add('hidden')
    this.isCollapsed = false
    this.saveCollapsedState()
    this.updateToggleIcon()
  }

  private collapse(): void {
    this.panel?.classList.add('collapsed')
    this.collapsedBadge?.classList.remove('hidden')
    this.isCollapsed = true
    this.saveCollapsedState()
    this.updateToggleIcon()
  }

  private updateToggleIcon(): void {
    if (!this.toggleBtn || !this.shadowRoot) return

    const svg = this.toggleBtn.querySelector('svg')
    if (!svg) return

    if (this.isCollapsed) {
      svg.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>'
      this.toggleBtn.setAttribute('aria-label', 'Expandir panel')
      this.toggleBtn.title = 'Expandir'
    } else {
      svg.innerHTML = '<polyline points="15 18 9 12 15 6"></polyline>'
      this.toggleBtn.setAttribute('aria-label', 'Colapsar panel')
      this.toggleBtn.title = 'Colapsar'
    }
  }

  // Public API
  updateAgents(agents: Agent[]): void {
    if (!this.agentsList || !this.shadowRoot) return

    const currentAgentName = this.currentAgentName
    const isConnected = this.serverConnected

    if (!agents || agents.length === 0) {
      this.agentsList.innerHTML = `
        <div class="wts-empty">
          ${isConnected ? 'No hay agentes conectados' : 'Conectando al servidor...'}
        </div>
      `
      this.updateBadgeCount(0)
      return
    }

    // Track chat start times locally (reliable even if server drops chatStartTime)
    for (const agent of agents) {
      const prevContact = this.chatContacts.get(agent.name)
      if (agent.status === 'active' && agent.contact) {
        if (!this.localChatTimes.has(agent.name) || prevContact !== agent.contact) {
          this.localChatTimes.set(agent.name, Date.now())
        }
        this.chatContacts.set(agent.name, agent.contact)
      } else if (agent.status !== 'active') {
        this.localChatTimes.delete(agent.name)
        this.chatContacts.delete(agent.name)
      }
    }

    this.agentsList.innerHTML = agents.map((agent) => {
      const isCurrentUser = agent.name === currentAgentName
      const statusClass = getStatusClass(agent.status)
      const contactHtml = agent.contact
        ? `<span class="wts-agent-contact ${agent.status === 'paused' ? 'paused' : ''}">${agent.contact}</span>`
        : agent.status === 'available'
          ? `<span class="wts-agent-contact available">Disponible</span>`
          : ''

      const chatStartTime = this.localChatTimes.get(agent.name)
      const timerHtml = agent.status === 'active' && agent.contact && chatStartTime
        ? `<span class="wts-agent-timer" data-start="${chatStartTime}">${this.formatElapsed(chatStartTime)}</span>`
        : ''

      return `
        <div class="wts-agent ${isCurrentUser ? 'current-user' : ''}" data-agent="${agent.name}">
          <div class="wts-agent-avatar" style="background: ${agent.color || getStatusColor(agent.status)}">
            ${agent.name.charAt(0).toUpperCase()}
          </div>
          <div class="wts-agent-info">
            <div class="wts-agent-name">
              <span>${this.escapeHtml(agent.name)}</span>
              ${timerHtml}
            </div>
            <div class="wts-agent-status">
              <span class="wts-status-dot ${statusClass}"></span>
              <span>${getStatusLabel(agent.status)}</span>
              ${contactHtml}
            </div>
          </div>
          ${isCurrentUser ? `
            <button class="wts-delete-btn" data-agent="${agent.name}" title="Eliminar usuario" aria-label="Eliminar usuario">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          ` : ''}
        </div>
      `
    }).join('')

    // Add delete button listeners
    this.agentsList.querySelectorAll('.wts-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const agentName = (e.currentTarget as HTMLElement).dataset.agent
        if (agentName) this.deleteAgent(agentName)
      })
    })

    this.updateBadgeCount(agents.filter(a => a.status !== 'offline').length)
    this.startTimer()
  }

  updateCurrentUserStatus(status: AgentStatus): void {
    if (!this.agentsList) return

    const currentAgentEl = this.agentsList.querySelector('.wts-agent.current-user')
    if (!currentAgentEl) return

    const statusEl = currentAgentEl.querySelector('.wts-agent-status')
    if (!statusEl) return

    const statusClass = getStatusClass(status)
    const statusLabel = getStatusLabel(status)

    statusEl.innerHTML = `
      <span class="wts-status-dot ${statusClass}"></span>
      <span>${statusLabel}</span>
    `
  }

  updateCurrentUserName(name: string): void {
    this.currentAgentName = name
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused
    if (paused) {
      this.pauseBtn?.classList.add('hidden')
      this.resumeBtn?.classList.remove('hidden')
    } else {
      this.resumeBtn?.classList.add('hidden')
      this.pauseBtn?.classList.remove('hidden')
    }
  }

  updateServerStatus(connected: boolean): void {
    this.serverConnected = connected
    const statusEl = this.shadowRoot?.getElementById('wts-server-status')
    if (!statusEl) return

    if (connected) {
      statusEl.classList.add('connected')
      statusEl.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="16 8 12 12 8 16"></polyline>
        </svg>
        <span>Conectado al servidor</span>
      `
    } else {
      statusEl.classList.remove('connected')
      statusEl.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <span>Servidor desconectado - Reintentando...</span>
      `
    }
  }

  private updateBadgeCount(count: number): void {
    const countEl = this.shadowRoot?.getElementById('wts-badge-count')
    if (countEl) {
      countEl.textContent = count.toString()
    }
  }

  private formatElapsed(startTime: number): string {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    const mins = Math.floor(elapsed / 60)
    const secs = elapsed % 60
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  private startTimer(): void {
    if (this.timerInterval) return
    this.timerInterval = setInterval(() => {
      const timers = this.shadowRoot?.querySelectorAll('.wts-agent-timer')
      if (!timers || timers.length === 0) {
        this.stopTimer()
        return
      }
      timers.forEach(el => {
        const start = parseInt((el as HTMLElement).dataset.start || '0')
        el.textContent = this.formatElapsed(start)
      })
    }, 1000)
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval)
      this.timerInterval = null
    }
  }

  private escapeHtml(text: string): void {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  private deleteAgent(agentName: string): void {
    if (!confirm(`¿Eliminar usuario "${agentName}"?`)) return
    chrome.runtime.sendMessage({
      type: 'DELETE_AGENT',
      agentName
    })
  }
}