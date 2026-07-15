import './popup.css'

const DEFAULT_SERVER_URL = 'ws://localhost:3001'
const AGENT_LIST_KEY = 'wts_agent_list'
const CONFIG_KEY = 'wts_agent_config'
const DEFAULT_AGENTS = ['Agente 1', 'Agente 2', 'Agente 3']

interface AgentConfig { agentName: string; serverUrl: string }

const $ = (id: string) => document.getElementById(id) as HTMLElement
const qs = <T extends HTMLElement>(sel: string, parent?: HTMLElement) => (parent || document).querySelector<T>(sel)

let currentConfig: AgentConfig | null = null
let agentList: string[] = []
let isPaused = false

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
  const cls: Record<string,string> = { 'Disponible':'badge-available', 'Pausado':'badge-paused', 'Atendiendo':'badge-attending' }
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
<div class="agent-item" data-agent="${name}">
  <div class="agent-avatar" style="background:${color}">${initial}</div>
  <span class="agent-name">${escapeHtml(name)}</span>
  <button class="agent-delete-btn" data-agent="${name}" title="Eliminar">
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

function selectAgent(name: string) {
  currentConfig = { agentName: name, serverUrl: DEFAULT_SERVER_URL }
  saveConfig(currentConfig)
  $('display-name').textContent = name
  showView('connected')
  updateStatus(false, true)
  updateBadge('Conectando...')
  $('current-agent-bar').classList.remove('hidden')
  $('action-buttons').classList.remove('hidden')
  chrome.runtime.sendMessage({ type: 'POPUP_READY', agentName: name })
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

// --- Init ---
async function init() {
  currentConfig = await loadConfig()
  agentList = await loadAgentList()

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
        updateBadge(isPaused ? 'Pausado' : 'Disponible')
        ;($('pause-btn') as HTMLButtonElement).disabled = false
        ;($('resume-btn') as HTMLButtonElement).disabled = !isPaused
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
          updateBadge(isPaused ? 'Pausado' : 'Disponible')
          ;($('pause-btn') as HTMLButtonElement).disabled = false
          ;($('resume-btn') as HTMLButtonElement).disabled = !isPaused
        } else {
          updateBadge('Desconectado')
          ;($('pause-btn') as HTMLButtonElement).disabled = true
          ;($('resume-btn') as HTMLButtonElement).disabled = true
        }
        break
      case 'AGENT_STATUS':
        updateBadge(msg.status)
        break
      case 'SERVER_DISCONNECTED':
        setServerWarning(true)
        updateStatus(false)
        updateBadge('Desconectado')
        ;($('pause-btn') as HTMLButtonElement).disabled = true
        ;($('resume-btn') as HTMLButtonElement).disabled = true
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
  })
  $('custom-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') ($('connect-custom-btn') as HTMLButtonElement).click()
  })

  // Connected view actions
  $('change-agent-btn').addEventListener('click', () => {
    renderAgentList()
    showView('setup')
  })

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

})