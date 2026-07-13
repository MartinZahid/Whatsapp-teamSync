// Options page - Server URL configuration

import './options.css'

const SERVER_URL_KEY = 'wts_server_url'
const DEFAULT_SERVER_URL = 'ws://localhost:3001'

const serverUrlInput = document.getElementById('server-url') as HTMLInputElement
const saveBtn = document.getElementById('save-server') as HTMLButtonElement
const testBtn = document.getElementById('test-connection') as HTMLButtonElement
const resultDiv = document.getElementById('connection-result') as HTMLDivElement
const versionEl = document.getElementById('version') as HTMLElement
const serverStatusEl = document.getElementById('server-status') as HTMLElement
const resetBtn = document.getElementById('reset-all') as HTMLButtonElement

async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get(SERVER_URL_KEY)
    serverUrlInput.value = result[SERVER_URL_KEY] || DEFAULT_SERVER_URL

    // Get extension info
    const manifest = chrome.runtime.getManifest()
    versionEl.textContent = manifest.version
    await updateServerStatus()
  } catch (error) {
    console.error('[Options] Error loading settings:', error)
    serverUrlInput.value = DEFAULT_SERVER_URL
  }
}

async function saveSettings(): Promise<void> {
  const url = serverUrlInput.value.trim()

  if (!url) {
    showResult('error', 'La URL no puede estar vacía')
    return
  }

  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    showResult('error', 'La URL debe usar protocolo ws:// o wss://')
    return
  }

  try {
    await chrome.storage.sync.set({ [SERVER_URL_KEY]: url })
    showResult('success', 'Configuración guardada correctamente')

    // Notify background script to reconnect
    chrome.runtime.sendMessage({
      type: 'UPDATE_SERVER_URL',
      url
    })

    await updateServerStatus()
  } catch (error) {
    console.error('[Options] Error saving settings:', error)
    showResult('error', 'Error al guardar la configuración')
  }
}

async function testConnection(): Promise<void> {
  const url = serverUrlInput.value.trim()

  if (!url) {
    showResult('error', 'Ingresa una URL primero')
    return
  }

  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    showResult('error', 'La URL debe usar protocolo ws:// o wss://')
    return
  }

  testBtn.disabled = true
  testBtn.textContent = 'Probando...'
  showResult('info', 'Conectando...')

  try {
    const connected = await testWebSocket(url)
    if (connected) {
      showResult('success', '✓ Conexión exitosa al servidor')
      serverStatusEl.textContent = 'Conectado'
      serverStatusEl.style.color = 'var(--success)'
    } else {
      showResult('error', '✗ No se pudo conectar al servidor')
      serverStatusEl.textContent = 'Error de conexión'
      serverStatusEl.style.color = 'var(--danger)'
    }
  } catch (error) {
    console.error('[Options] Connection test error:', error)
    showResult('error', `✗ Error: ${error instanceof Error ? error.message : 'Desconocido'}`)
    serverStatusEl.textContent = 'Error'
    serverStatusEl.style.color = 'var(--danger)'
  } finally {
    testBtn.disabled = false
    testBtn.textContent = 'Probar conexión'
  }
}

function testWebSocket(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      resolve(false)
      return
    }

    const timeout = setTimeout(() => {
      ws.close()
      resolve(false)
    }, 5000)

    ws.onopen = () => {
      clearTimeout(timeout)
      ws.close()
      resolve(true)
    }

    ws.onerror = () => {
      clearTimeout(timeout)
      resolve(false)
    }

    ws.onclose = () => {
      clearTimeout(timeout)
    }
  })
}

async function updateServerStatus(): Promise<void> {
  const result = await chrome.storage.sync.get(SERVER_URL_KEY)
  const url = result[SERVER_URL_KEY] || DEFAULT_SERVER_URL

  try {
    const connected = await testWebSocket(url)
    serverStatusEl.textContent = connected ? 'Conectado' : 'Desconectado'
    serverStatusEl.style.color = connected ? 'var(--success)' : 'var(--danger)'
  } catch {
    serverStatusEl.textContent = 'Error'
    serverStatusEl.style.color = 'var(--danger)'
  }
}

function showResult(type: 'success' | 'error' | 'info', message: string): void {
  resultDiv.className = `result ${type}`
  resultDiv.textContent = message
  resultDiv.classList.remove('hidden')
}

async function resetAll(): Promise<void> {
  if (!confirm('¿Estás seguro? Esto restablecerá la URL del servidor y notificará a la extensión.')) {
    return
  }

  try {
    await chrome.storage.sync.clear()
    serverUrlInput.value = DEFAULT_SERVER_URL
    showResult('success', 'Configuración restablecida. Recarga la extensión.')

    // Notify background
    chrome.runtime.sendMessage({
      type: 'UPDATE_SERVER_URL',
      url: DEFAULT_SERVER_URL
    })

    await updateServerStatus()
  } catch (error) {
    console.error('[Options] Error resetting:', error)
    showResult('error', 'Error al restablecer')
  }
}

// Event listeners
saveBtn.addEventListener('click', saveSettings)
testBtn.addEventListener('click', testConnection)
resetBtn.addEventListener('click', resetAll)

serverUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    saveSettings()
  }
})

// Initialize
loadSettings()