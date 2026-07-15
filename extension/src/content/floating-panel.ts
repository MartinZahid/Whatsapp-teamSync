// Floating Panel - Injected UI showing agent presence

import type { Agent, AgentStatus } from '@shared/types.js'
import { getStatusColor, getStatusLabel, getStatusClass } from '@shared/types.js'

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
    return `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      :root {
        --wts-primary: #F97316;
        --wts-primary-hover: #EA580C;
        --wts-bg: #ffffff;
        --wts-text: #1F2937;
        --wts-text-muted: #6B7280;
        --wts-border: #E5E7EB;
        --wts-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
        --wts-radius: 12px;
        --wts-active: #EF4444;
        --wts-paused: #F59E0B;
        --wts-available: #22C55E;
        --wts-offline: #9CA3AF;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --wts-bg: #1F2937;
          --wts-text: #F3F4F6;
          --wts-text-muted: #9CA3AF;
          --wts-border: #374151;
        }
      }

      .wts-panel {
        pointer-events: auto;
        width: 300px;
        background: var(--wts-bg);
        border-radius: var(--wts-radius);
        box-shadow: var(--wts-shadow);
        border: 1px solid var(--wts-border);
        overflow: hidden;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
        transform-origin: top right;
      }

      .wts-panel.collapsed {
        transform: scale(0.9) translateX(100%);
        opacity: 0;
        pointer-events: none;
      }

      .wts-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: linear-gradient(135deg, #F97316 0%, #EA580C 100%);
        color: white;
      }

      .wts-header h3 {
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .wts-logo {
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        color: #F97316;
      }

      .wts-toggle {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        border-radius: 6px;
        padding: 6px 8px;
        cursor: pointer;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .wts-toggle:hover { background: rgba(255, 255, 255, 0.3); }
      .wts-toggle svg { width: 18px; height: 18px; stroke: currentColor; }

      .wts-agents {
        max-height: 400px;
        overflow-y: auto;
        padding: 8px;
      }

      .wts-agent {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 8px;
        transition: background 0.15s;
        position: relative;
      }

      .wts-agent:hover { background: #F3F4F6; }

      @media (prefers-color-scheme: dark) {
        .wts-agent:hover { background: #374151; }
      }

      .wts-agent.current-user { background: #F0FDF4; }

      @media (prefers-color-scheme: dark) {
        .wts-agent.current-user { background: #14532D; }
      }

      .wts-delete-btn {
        background: transparent;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--wts-text-muted);
        border-radius: 4px;
        opacity: 0;
        transition: opacity 0.2s, color 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .wts-agent:hover .wts-delete-btn {
        opacity: 1;
      }

      .wts-delete-btn:hover {
        color: #EF4444;
        background: rgba(239, 68, 68, 0.1);
      }

      .wts-agent-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 14px;
        color: white;
        flex-shrink: 0;
      }

      .wts-agent-info { flex: 1; min-width: 0; }

      .wts-agent-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--wts-text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .wts-agent.current-user .wts-agent-name::after {
        content: ' (tú)';
        font-weight: 400;
        color: #F97316;
        font-size: 12px;
      }

      .wts-agent-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--wts-text-muted);
        margin-top: 2px;
      }

      .wts-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .wts-status-dot.active { background: var(--wts-active); }
      .wts-status-dot.paused { background: var(--wts-paused); }
      .wts-status-dot.available { background: var(--wts-available); }
      .wts-status-dot.offline { background: var(--wts-offline); }

      .wts-agent-contact {
        font-size: 11px;
        color: var(--wts-active);
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }

      .wts-agent-contact.paused { color: var(--wts-paused); }

      .wts-empty {
        padding: 20px;
        text-align: center;
        color: var(--wts-text-muted);
        font-size: 13px;
      }

      .wts-actions {
        padding: 8px 12px;
        display: flex;
        gap: 6px;
        border-top: 1px solid var(--wts-border);
      }
      .wts-pause-btn {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 7px 12px;
        border: 1px solid var(--wts-border);
        border-radius: 6px;
        background: transparent;
        color: var(--wts-paused);
        font-size: 12px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.15s;
      }
      .wts-pause-btn:hover { background: #FEF3C7; }
      .wts-pause-btn svg { width: 14px; height: 14px; }
      .wts-resume-btn {
        color: #9A3412;
        border-color: var(--wts-primary);
        background: #FED7AA;
      }
      .wts-resume-btn:hover { background: #FDBA74; }

      .wts-server-status {
        padding: 8px 16px;
        background: #FEF2F2;
        border-top: 1px solid #FECACA;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: #991B1B;
      }

      .wts-server-status.connected {
        background: #F0FDF4;
        border-top-color: #86EFAC;
        color: #166534;
      }

      @media (prefers-color-scheme: dark) {
        .wts-server-status {
          background: #7F1D1D;
          border-top-color: #991B1B;
        }
        .wts-server-status.connected {
          background: #14532D;
          border-top-color: #166534;
        }
      }

      .wts-collapsed-badge {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        background: linear-gradient(135deg, #F97316 0%, #EA580C 100%);
        color: white;
        padding: 10px 14px;
        border-radius: 50px;
        box-shadow: var(--wts-shadow);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        pointer-events: auto;
        animation: wts-badge-in 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border: none;
      }

      .wts-collapsed-badge:hover { opacity: 0.9; }

      .wts-collapsed-badge svg { width: 18px; height: 18px; }

      @keyframes wts-badge-in {
        from { opacity: 0; transform: scale(0.8); }
        to { opacity: 1; transform: scale(1); }
      }

      .hidden { display: none !important; }

      @media (prefers-reduced-motion: reduce) {
        .wts-panel, .wts-panel.collapsed, .wts-collapsed-badge { animation: none !important; }
      }

      .wts-agents::-webkit-scrollbar { width: 6px; }
      .wts-agents::-webkit-scrollbar-track { background: transparent; }
      .wts-agents::-webkit-scrollbar-thumb {
        background: var(--wts-border);
        border-radius: 3px;
      }
      .wts-agents::-webkit-scrollbar-thumb:hover { background: var(--wts-text-muted); }
    `
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

    this.agentsList.innerHTML = agents.map((agent) => {
      const isCurrentUser = agent.name === currentAgentName
      const statusClass = getStatusClass(agent.status)
      const contactHtml = agent.contact
        ? `<span class="wts-agent-contact ${agent.status === 'paused' ? 'paused' : ''}">${agent.contact}</span>`
        : agent.status === 'available'
          ? `<span class="wts-agent-contact available">Disponible</span>`
          : ''

      return `
        <div class="wts-agent ${isCurrentUser ? 'current-user' : ''}" data-agent="${agent.name}">
          <div class="wts-agent-avatar" style="background: ${agent.color || getStatusColor(agent.status)}">
            ${agent.name.charAt(0).toUpperCase()}
          </div>
          <div class="wts-agent-info">
            <div class="wts-agent-name">${this.escapeHtml(agent.name)}</div>
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

  private escapeHtml(text: string): string {
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