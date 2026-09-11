import './popup.css'
import type { AgentConfig, AgentStatus } from '@shared/types.js'
import { getStatusLabel } from '@shared/types.js'

const DEFAULT_SERVER_URL = 'ws://localhost:3001'
const AGENT_LIST_KEY = 'wts_agent_list'
const CONFIG_KEY = 'wts_agent_config'
const SERVER_URL_KEY = 'wts_server_url'
const DEFAULT_AGENTS = ['Agente 1', 'Agente 2', 'Agente 3']

const $ = (id: string) => document.getElementById(id) as HTMLElement
const qs = <T extends HTMLElement>(sel: string, parent?: HTMLElement) => (parent || document).querySelector<T>(sel)

let currentConfig: AgentConfig | null = null
let agentList: string[] = []
let isPaused = false
let isHelpRequested = false

// --- Storage ---
async function loadConfig(): Promise<AgentConfig | null> {
  return new Promise(r => chrome.storage.local.get(CONFIG_KEY, res => r(res[CONFIG_KEY] || null)))
}
function saveConfig(c: AgentConfig) { chrome.storage.local.set({ [CONFIG_KEY]: c }) }

async function loadAgentList(): Promise<string[]> {
  return new Promise(r => chrome.storage.local.get(AGENT_LIST_KEY, res => {
    if (res[AGENT_LIST_KEY]) r(res[AGENT_LIST_KEY])
    else { chrome.storage.local.set({ [AGENT_LIST_KEY]: DEFAULT_AGENTS }); r(DEFAULT_AGENTS) }
  }))
}
function saveAgentList(list: string[]) { chrome.storage.local.set({ [AGENT_LIST_KEY]: list }) }

function showSetupResult(type: 'info' | 'success' | 'error', message: string): void {
  const result = $('setup-result')
  result.className = `setup-result ${type}`
  result.textContent = message
}

function clearSetupResult(): void {
  $('setup-result').className = 'setup-result hidden'
}

function showConnectionResult(type: 'info' | 'success' | 'error', message: string): void {
  const result = $('connection-result')
  result.className = `connection-result ${type}`
  result.textContent = message
}

function isValidServerUrl(url: string): boolean {
  return url.startsWith('ws://') || url.startsWith('wss://')
}

function testWebSocket(url: string): Promise<boolean> {
  return new Promise(resolve => {
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      resolve(false)
      return
    }

    const timeout = window.setTimeout(() => {
      ws.close()
      resolve(false)
    }, 5000)

    ws.onopen = () => {
      window.clearTimeout(timeout)
      ws.close()
      resolve(true)
    }
    ws.onerror = () => {
      window.clearTimeout(timeout)
      resolve(false)
    }
  })
}

// --- Views ---
function showView(v: 'setup' | 'connected') {
  $('setup-view').classList.toggle('hidden', v !== 'setup')
  $('connected-view').classList.toggle('hidden', v !== 'connected')
}

function updateStatus(connected: boolean, connecting = false) {
  const dot = $('status-dot')
  dot.classList.remove('connecting', 'connected', 'disconnected')
  if (connecting) { dot.classList.add('connecting'); $('status-text').textContent = 'Conectando...' }
  else if (connected) { dot.classList.add('connected'); $('status-text').textContent = 'Conectado' }
  else { dot.classList.add('disconnected'); $('status-text').textContent = 'Desconectado' }
}

function updateBadge(status: string) {
  const badge = $('status-badge')
  badge.textContent = status
  badge.className = 'badge'
  const cls: Record<string,string> = { 'Disponible':'badge-available', 'Pausado':'badge-paused', 'Atendiendo':'badge-attending', 'Ayuda':'badge-help' }
  badge.classList.add(cls[status] || 'badge-offline')
}

function setServerWarning(show: boolean) { $('server-status').classList.toggle('hidden', !show) }

// --- Agent list rendering ---
function renderAgentList() {
  const list = $('agent-list')
  list.innerHTML = agentList.map(name => {
    const initial = name.charAt(0).toUpperCase()
    const colors = ['#F97316','#EF4444','#F59E0B','#3B82F6','#8B5CF6','#EC4899']
    const color = colors[agentList.indexOf(name) % colors.length]
    return `
<div class="agent-item" data-agent="${escapeAttribute(name)}">
  <div class="agent-avatar" style="background:${color}">${initial}</div>
  <span class="agent-name">${escapeHtml(name)}</span>
  <button class="agent-delete-btn" data-agent="${escapeAttribute(name)}" title="Eliminar">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  </button>
</div>`
  }).join('')

  // Click to select
  list.querySelectorAll('.agent-item').forEach(el => {
    el.addEventListener('click', () => {
      const name = (el as HTMLElement).dataset.agent
      if (name) selectAgent(name)
    })
  })

  // Delete
  list.querySelectorAll('.agent-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      const name = (btn as HTMLElement).dataset.agent
      if (name) deleteAgent(name)
    })
  })
}

async function selectAgent(name: string): Promise<void> {
  const serverUrlInput = $('server-url') as HTMLInputElement
  const serverUrl = serverUrlInput.value.trim()

  if (!serverUrl) {
    showSetupResult('error', 'Ingresa la URL del servidor')
    serverUrlInput.focus()
    return
  }
  if (!isValidServerUrl(serverUrl)) {
    showSetupResult('error', 'La URL debe comenzar con ws:// o wss://')
    serverUrlInput.focus()
    return
  }

  const connectButton = $('connect-custom-btn') as HTMLButtonElement
  connectButton.disabled = true
  showSetupResult('info', 'Probando conexión...')

  if (!(await testWebSocket(serverUrl))) {
    connectButton.disabled = false
    showSetupResult('error', 'No se pudo conectar al servidor')
    return
  }

  await chrome.storage.sync.set({ [SERVER_URL_KEY]: serverUrl })
  currentConfig = { agentName: name, serverUrl }
  saveConfig(currentConfig)
  $('display-name').textContent = name
  showView('connected')
  updateStatus(false, true)
  updateBadge('Conectando...')
  $('current-agent-bar').classList.remove('hidden')
  $('action-buttons').classList.remove('hidden')
  chrome.runtime.sendMessage({ type: 'UPDATE_SERVER_URL', url: serverUrl }).catch(() => {})
  chrome.runtime.sendMessage({ type: 'POPUP_READY', agentName: name }).catch(() => {})
  connectButton.disabled = false
}

async function testCurrentConnection(): Promise<void> {
  const input = $('server-url') as HTMLInputElement
  const url = input.value.trim()

  if (!url) {
    showConnectionResult('error', 'Ingresa la URL del servidor')
    input.focus()
    return
  }
  if (!isValidServerUrl(url)) {
    showConnectionResult('error', 'La URL debe comenzar con ws:// o wss://')
    input.focus()
    return
  }

  const button = $('test-connection-btn') as HTMLButtonElement
  button.disabled = true
  showConnectionResult('info', 'Probando conexión...')
  const connected = await testWebSocket(url)
  button.disabled = false
  showConnectionResult(connected ? 'success' : 'error', connected ? 'Conexión exitosa' : 'No se pudo conectar al servidor')
}

function deleteAgent(name: string) {
  agentList = agentList.filter(a => a !== name)
  saveAgentList(agentList)
  renderAgentList()
}

function escapeHtml(text: string): string {
  const d = document.createElement('div')
  d.textContent = text
  return d.innerHTML
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// --- Init ---
async function init() {
  currentConfig = await loadConfig()
  agentList = await loadAgentList()
  const serverResult = await chrome.storage.sync.get(SERVER_URL_KEY)
  ;($('server-url') as HTMLInputElement).value = serverResult[SERVER_URL_KEY] || currentConfig?.serverUrl || DEFAULT_SERVER_URL
  ;($('custom-name-input') as HTMLInputElement).value = currentConfig?.agentName || ''

  if (currentConfig?.agentName) {
    $('display-name').textContent = currentConfig.agentName
    $('current-agent-bar').classList.remove('hidden')
    $('action-buttons').classList.remove('hidden')
    showView('connected')
    updateStatus(false)
    updateBadge('Desconectado')
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'GET_CONNECTION_STATUS' })
      if (resp?.connected) {
        updateStatus(true)
        // Sync real state from background
        const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' })
        if (state) {
          isPaused = state.isPaused
          isHelpRequested = state.isHelpRequested
        }
        const badgeText = isHelpRequested ? 'Ayuda' : (isPaused ? 'Pausado' : 'Disponible')
        updateBadge(badgeText)
        ;($('pause-btn') as HTMLButtonElement).disabled = false
        ;($('pause-btn') as HTMLButtonElement).hidden = isPaused
        ;($('resume-btn') as HTMLButtonElement).disabled = !isPaused
        ;($('resume-btn') as HTMLButtonElement).hidden = !isPaused
        ;($('help-btn') as HTMLButtonElement).disabled = false
        ;($('help-btn') as HTMLButtonElement).hidden = isHelpRequested
        ;($('cancel-help-btn') as HTMLButtonElement).disabled = !isHelpRequested
        ;($('cancel-help-btn') as HTMLButtonElement).hidden = !isHelpRequested
      }
    } catch {}
    chrome.runtime.sendMessage({ type: 'POPUP_READY', agentName: currentConfig.agentName })
  } else {
    renderAgentList()
    showView('setup')
  }
}

// --- Event listeners ---
document.addEventListener('DOMContentLoaded', () => {
  // Listen for background messages (register before init to avoid race condition)
  chrome.runtime.onMessage.addListener(msg => {
    switch (msg.type) {
      case 'CONNECTION_STATUS':
        updateStatus(msg.connected)
        setServerWarning(!msg.connected)
        if (msg.connected) {
          const badgeText = isHelpRequested ? 'Ayuda' : (isPaused ? 'Pausado' : 'Disponible')
          updateBadge(badgeText)
          ;($('pause-btn') as HTMLButtonElement).disabled = false
          ;($('resume-btn') as HTMLButtonElement).disabled = !isPaused
          ;($('help-btn') as HTMLButtonElement).disabled = false
          ;($('cancel-help-btn') as HTMLButtonElement).disabled = !isHelpRequested
        } else {
          updateBadge('Desconectado')
          ;($('pause-btn') as HTMLButtonElement).disabled = true
          ;($('resume-btn') as HTMLButtonElement).disabled = true
          ;($('help-btn') as HTMLButtonElement).disabled = true
          ;($('cancel-help-btn') as HTMLButtonElement).disabled = true
        }
        break
      case 'AGENT_STATUS':
        updateBadge(getStatusLabel(msg.status as AgentStatus))
        break
      case 'SERVER_DISCONNECTED':
        setServerWarning(true)
        updateStatus(false)
        updateBadge('Desconectado')
        ;($('pause-btn') as HTMLButtonElement).disabled = true
        ;($('resume-btn') as HTMLButtonElement).disabled = true
        ;($('help-btn') as HTMLButtonElement).disabled = true
        ;($('cancel-help-btn') as HTMLButtonElement).disabled = true
        break
    }
  })

  init()

  // Add agent button
  $('add-agent-btn').addEventListener('click', () => {
    $('add-agent-btn').classList.add('hidden')
    $('add-agent-form').classList.remove('hidden')
    ;($('new-agent-input') as HTMLInputElement).focus()
  })

  $('confirm-add-btn').addEventListener('click', () => {
    const input = $('new-agent-input') as HTMLInputElement
    const name = input.value.trim()
    if (name && !agentList.includes(name)) {
      agentList.push(name)
      saveAgentList(agentList)
      renderAgentList()
    }
    input.value = ''
    $('add-agent-form').classList.add('hidden')
    $('add-agent-btn').classList.remove('hidden')
  })

  $('cancel-add-btn').addEventListener('click', () => {
    ;($('new-agent-input') as HTMLInputElement).value = ''
    $('add-agent-form').classList.add('hidden')
    $('add-agent-btn').classList.remove('hidden')
  })

  $('new-agent-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') ($('confirm-add-btn') as HTMLButtonElement).click()
    if (e.key === 'Escape') ($('cancel-add-btn') as HTMLButtonElement).click()
  })

  // Custom name connect
  $('connect-custom-btn').addEventListener('click', () => {
    const name = ($('custom-name-input') as HTMLInputElement).value.trim()
    if (name) selectAgent(name)
    else showSetupResult('error', 'Ingresa el nombre del agente')
  })
  $('custom-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') ($('connect-custom-btn') as HTMLButtonElement).click()
  })

  // Connected view actions
  $('change-agent-btn').addEventListener('click', () => {
    if (currentConfig) {
      ;($('server-url') as HTMLInputElement).value = currentConfig.serverUrl
      ;($('custom-name-input') as HTMLInputElement).value = currentConfig.agentName
    }
    clearSetupResult()
    renderAgentList()
    showView('setup')
  })
  $('test-connection-btn').addEventListener('click', testCurrentConnection)

  $('pause-btn').addEventListener('click', () => {
    isPaused = true
    ;($('pause-btn') as HTMLButtonElement).hidden = true
    ;($('pause-btn') as HTMLButtonElement).disabled = true
    ;($('resume-btn') as HTMLButtonElement).hidden = false
    ;($('resume-btn') as HTMLButtonElement).disabled = false
    updateBadge('Pausado')
    chrome.runtime.sendMessage({ type: 'PAUSED' })
  })

  $('resume-btn').addEventListener('click', () => {
    isPaused = false
    ;($('pause-btn') as HTMLButtonElement).hidden = false
    ;($('pause-btn') as HTMLButtonElement).disabled = false
    ;($('resume-btn') as HTMLButtonElement).hidden = true
    ;($('resume-btn') as HTMLButtonElement).disabled = true
    updateBadge('Disponible')
    chrome.runtime.sendMessage({ type: 'RESUMED' })
  })

  $('help-btn').addEventListener('click', () => {
    isHelpRequested = true
    ;($('help-btn') as HTMLButtonElement).hidden = true
    ;($('help-btn') as HTMLButtonElement).disabled = true
    ;($('cancel-help-btn') as HTMLButtonElement).hidden = false
    ;($('cancel-help-btn') as HTMLButtonElement).disabled = false
    updateBadge('Ayuda')
    chrome.runtime.sendMessage({ type: 'HELP_REQUEST', requesting: true })
  })

  $('cancel-help-btn').addEventListener('click', () => {
    isHelpRequested = false
    ;($('cancel-help-btn') as HTMLButtonElement).hidden = true
    ;($('cancel-help-btn') as HTMLButtonElement).disabled = true
    ;($('help-btn') as HTMLButtonElement).hidden = false
    ;($('help-btn') as HTMLButtonElement).disabled = false
    updateBadge(isPaused ? 'Pausado' : 'Disponible')
    chrome.runtime.sendMessage({ type: 'HELP_REQUEST', requesting: false })
  })

})
