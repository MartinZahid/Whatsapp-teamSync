// WebSocket Server for WhatsApp Team Sync + Metrics Dashboard

import { WebSocketServer, WebSocket } from 'ws'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { RoomManager } from './rooms.js'
import { initDatabase, saveDatabase, insertEvent, queryDailyStats, queryPeakHours, queryTopAgents, querySessions, exportJSON } from './database.js'
import { WSMessage, isAttendingMessage, isPausedMessage, isAvailableMessage, isOfflineMessage, ErrorMessage } from './types.js'
import { APP_VERSION } from '../../shared/version.js'
import { fileURLToPath } from 'url'
import {
  authorizeUrl, exchangeCode, createSession, getSession, destroySession, destroyAllSessions,
  getSessionToken, rotateSession, sessionCookie, clearSessionCookie, stateCookie, newState,
  verifyState, isAllowedUser, isOAuthConfigured, ALLOWED_EMAIL, clientIp, clientUa,
  rateLimit, pinConfigured, verifyPin, resetPinFails, registerPinFail, pinBlockRemaining, setPin,
  isTerminalDisabled, setTerminalDisabled, audit, pruneAuth
} from './auth.js'
import { attachTerminal, closeAllTerminals } from './terminal.js'
import { handleAppRequest, isMobileClient, stopPersistent } from './opencode-app.js'

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'
const HEARTBEAT_INTERVAL = 30000
const __dirname = join(fileURLToPath(import.meta.url), '..')

// Read a small JSON body (for /auth/verify-pin and /auth/set-pin)
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk
      if (data.length > limit) {
        req.destroy()
        reject(new Error('body too large'))
        return
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const roomManager = new RoomManager()

// --- MIME types for static files ---
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json'
}

// --- HTTP server for dashboard ---
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const path = url.pathname
  const isSecure = req.headers['x-forwarded-proto'] === 'https' || (req.url || '').startsWith('https')
  const ip = clientIp(req)
  const ua = clientUa(req)

  // --- OAuth routes (Terminal) ---
  if (path === '/auth/login') {
    if (!isOAuthConfigured()) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('OAuth de Google no configurado (falta google-oauth.json en server/data/)')
      return
    }
    if (!rateLimit(ip, 'login', 10, 10 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Demasiados intentos. Espera unos minutos.')
      return
    }
    const state = newState()
    res.setHeader('Set-Cookie', stateCookie(state))
    res.writeHead(302, { Location: authorizeUrl(state) })
    res.end()
    return
  }

  if (path === '/auth/callback') {
    if (!rateLimit(ip, 'callback', 20, 10 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Demasiados intentos. Espera unos minutos.')
      return
    }
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const user = code && verifyState(state) ? await exchangeCode(code) : null
    if (!user || !isAllowedUser(user)) {
      audit('login_denied', user?.email ?? null, ip, ua)
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><title>Acceso denegado</title><body style="font-family:sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh"><div style="text-align:center"><h1>Acceso denegado</h1><p>Solo <b>martinzahidpro@gmail.com</b> puede entrar.<br><a href="/auth/login" style="color:#7cfc5a">Intentar con otra cuenta</a></p></div></body>')
      return
    }
    const token = createSession(user.email, ip, ua)
    audit('login_ok', user.email, ip, ua)
    res.setHeader('Set-Cookie', sessionCookie(token, isSecure))
    res.writeHead(302, { Location: '/terminal' })
    res.end()
    return
  }

  if (path === '/auth/logout') {
    const token = getSessionToken(req)
    destroySession(token)
    res.setHeader('Set-Cookie', clearSessionCookie(isSecure))
    res.writeHead(302, { Location: '/' })
    res.end()
    return
  }

  if (path === '/auth/logout-all') {
    if (!getSession(getSessionToken(req), ip, ua)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    destroyAllSessions()
    audit('logout_all', undefined, ip, ua)
    res.setHeader('Set-Cookie', clearSessionCookie(isSecure))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (path === '/auth/me') {
    if (!rateLimit(ip, 'me', 60, 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ authenticated: false, rateLimited: true }))
      return
    }
    const token = getSessionToken(req)
    const session = getSession(token, ip, ua)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      authenticated: !!session,
      email: session?.email ?? null,
      pinVerified: session?.pinVerified ?? false,
      pinConfigured: pinConfigured(),
      enabled: !isTerminalDisabled(),
      sessionToken: token || null
    }))
    return
  }

  if (path === '/auth/verify-pin' && req.method === 'POST') {
    if (!rateLimit(ip, 'pin', 10, 15 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, tooMany: true }))
      return
    }
    const session = getSession(getSessionToken(req), ip, ua)
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, message: 'Sesión no válida' }))
      return
    }
    if (pinBlockRemaining(ip) > 0) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, blocked: Math.ceil(pinBlockRemaining(ip) / 1000) }))
      return
    }
    let pin = ''
    try { pin = String(JSON.parse(await readBody(req, 1024)).pin || '') } catch { /* no body */ }
    if (!verifyPin(pin)) {
      registerPinFail(ip)
      audit('pin_failed', session.email, ip, ua)
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, blocked: Math.ceil(pinBlockRemaining(ip) / 1000) }))
      return
    }
    resetPinFails(ip)
    const token = getSessionToken(req)
    const newToken = token ? rotateSession(token, ip, ua) : null
    audit('pin_ok', session.email, ip, ua)
    res.setHeader('Set-Cookie', newToken ? sessionCookie(newToken, isSecure) : clearSessionCookie(isSecure))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (path === '/auth/set-pin' && req.method === 'POST') {
    if (!rateLimit(ip, 'setpin', 5, 10 * 60 * 1000)) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, tooMany: true }))
      return
    }
    const session = getSession(getSessionToken(req), ip, ua)
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, message: 'Sesión no válida' }))
      return
    }
    if (!session.pinVerified) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, message: 'PIN no verificado' }))
      return
    }
    let current = ''
    let pin = ''
    try {
      const body = JSON.parse(await readBody(req, 1024))
      current = String(body.current || '')
      pin = String(body.pin || '')
    } catch { /* no body */ }
    if (!verifyPin(current)) {
      registerPinFail(ip)
      audit('pin_change_failed', session.email, ip, ua)
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    if (!/^\d{4,12}$/.test(pin)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, message: 'El PIN debe ser numérico (4-12 dígitos)' }))
      return
    }
    setPin(pin)
    audit('pin_changed', session.email, ip, ua)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (path === '/auth/terminal-off' || path === '/auth/terminal-on') {
    const session = getSession(getSessionToken(req), ip, ua)
    if (!session || !session.pinVerified) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false }))
      return
    }
    const off = path === '/auth/terminal-off'
    setTerminalDisabled(off)
    audit(off ? 'terminal_off' : 'terminal_on', session.email, ip, ua)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, enabled: !off }))
    return
  }

  // --- Terminal Celular (app movil opencode) ---
  if (handleAppRequest(req, res, url, path)) return

  // --- Terminal page ---
  if (path === '/terminal' || path === '/terminal/') {
    if (isMobileClient(req)) { res.writeHead(302, { Location: '/app' }); res.end(); return }
    const session = getSession(getSessionToken(req), ip, ua)
    try {
      let content: Buffer
      if (session) {
        content = readFileSync(join(__dirname, '..', '..', '..', 'public', 'terminal.html'))
      } else {
        content = Buffer.from(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terminal</title><body style="font-family:sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0"><div style="text-align:center"><h1>Terminal bloqueada</h1><a href="/auth/login" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#4285F4;color:#fff;border-radius:8px;text-decoration:none">Entrar con Google</a></div></body></html>`)
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(content)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Error interno')
    }
    return
  }

  // --- Gastómetro page ---
  if (path === '/gastometro' || path === '/gastometro/') {
    try {
      const content = readFileSync(join(__dirname, '..', '..', '..', 'public', 'gastometro.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(content)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Error interno')
    }
    return
  }

  if (path === '/gastometro/descargar') {
    try {
      const content = readFileSync(join(__dirname, '..', '..', '..', 'public', 'politica-privacidad.txt'))
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="politica-de-privacidad.txt"'
      })
      res.end(content)
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('No disponible aún')
    }
    return
  }

  // API routes
  if (path === '/api/metrics') {
    const days = Math.min(parseInt(url.searchParams.get('days') || '7'), 90)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      daily: queryDailyStats(days),
      peakHours: queryPeakHours(days),
      topAgents: queryTopAgents(days)
    }))
    return
  }

  if (path === '/api/agents') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(roomManager.getAllAgents()))
    return
  }

  if (path === '/api/sessions') {
    const days = Math.min(parseInt(url.searchParams.get('days') || '7'), 90)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(querySessions(days)))
    return
  }

  if (path === '/api/export') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="metrics-export.json"'
    })
    res.end(exportJSON())
    return
  }

  // Serve static files from server/public/
  let filePath = join(__dirname, '..', '..', '..', 'public', path === '/' ? 'dashboard.html' : path)
  if (!existsSync(filePath)) {
    filePath = join(__dirname, '..', '..', '..', 'public', 'dashboard.html')
  }

  try {
    const content = readFileSync(filePath)
    const ext = extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(content)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not found')
  }
})

// --- WebSocket attached to HTTP server ---
// NOTE: perMessageDeflate is intentionally OFF. The WebSocket is often
// reached through the coffecode-web reverse proxy (server.js), which rebuilds
// the 101 response by hand and strips Sec-WebSocket-Extensions. With deflate
// on, the browser never sees the negotiated extension and aborts with code
// 1002 on the first compressed frame. Frame batching already keeps traffic
// low; compression is not needed.
const wss = new WebSocketServer({ server: httpServer })

console.log(`[Server] Starting HTTP + WebSocket server on port ${PORT}...`)

// Heartbeat interval
setInterval(() => {
  roomManager.checkHeartbeats()
}, HEARTBEAT_INTERVAL)

// Prune expired sessions / rate buckets / pin blocks
setInterval(() => {
  pruneAuth()
}, 60_000)

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  // Disable Nagle's algorithm (noDelay) so small terminal frames are sent
  // immediately instead of being coalesced/buffered ~40ms on the wire.
  const sock = req.socket
  if (sock && typeof sock.setNoDelay === 'function') {
    sock.setNoDelay(true)
  }

  const wsPath = new URL(req.url || '/', 'http://localhost').pathname

  // --- Terminal WebSocket (sesión + PIN + kill-switch) ---
  if (wsPath === '/terminal/ws') {
    const ip = clientIp(req)
    const ua = clientUa(req)
    const token = getSessionToken(req)
    const session = getSession(token, ip, ua)
    if (!session || session.email !== ALLOWED_EMAIL) {
      ws.send('\r\n[Terminal] No autenticado. Vuelve a /auth/login\r\n')
      ws.close()
      return
    }
    if (isTerminalDisabled()) {
      ws.send('\r\n[Terminal] Terminal deshabilitada. Actívala desde la página.\r\n')
      ws.close()
      return
    }
    audit('terminal_session_open', session.email, ip, ua)
    // Sessions persist per auth token: reconnects re-attach to the same shell.
    const sessionKey = token || `ip:${ip}`
    attachTerminal(ws, sessionKey)
    // Keep the connection alive through NATs/proxies.
    const ka = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping()
      else clearInterval(ka)
    }, 30000)
    ws.on('close', () => clearInterval(ka))
    return
  }

  let agentId: string | null = null
  let isAuthenticated = false

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'WELCOME',
    message: 'Connected to WhatsApp Team Sync server',
    protocol: APP_VERSION
  }))

  ws.on('message', (data: Buffer) => {
    try {
      const message: WSMessage = JSON.parse(data.toString())

      // First message must be authentication (ATTENDING with agent name)
      if (!isAuthenticated) {
        if (isAttendingMessage(message) && message.agent) {
          agentId = roomManager.register(ws, message.agent)
          isAuthenticated = true

          // Send initial state
          roomManager.sendInitialState(agentId)
        } else {
          const error: ErrorMessage = {
            type: 'ERROR',
            code: 'AUTH_REQUIRED',
            message: 'First message must include agent name'
          }
          ws.send(JSON.stringify(error))
        }
        return
      }

      // Process subsequent messages
      if (agentId) {
        roomManager.handleMessage(agentId, message)
      }
    } catch (error) {
      console.error('[Server] Error parsing message:', error)
      const errorMsg: ErrorMessage = {
        type: 'ERROR',
        code: 'PARSE_ERROR',
        message: 'Invalid message format'
      }
      ws.send(JSON.stringify(errorMsg))
    }
  })

  // Send ping every 30 seconds
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    } else {
      clearInterval(pingInterval)
    }
  }, 30000)

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error)
  })

  ws.on('close', () => {
    clearInterval(pingInterval)
    if (agentId) {
      roomManager.disconnect(agentId)
    }
  })
})

wss.on('error', (error) => {
  console.error('[Server] Server error:', error)
})

// Graceful shutdown
function shutdown() {
  console.log('[Server] Shutting down...')
  try { saveDatabase() } catch { /* ignore */ }
  try { stopPersistent() } catch { /* ignore */ }
  try { closeAllTerminals() } catch { /* ignore */ }
  try { wss.clients.forEach((c) => c.terminate()) } catch { /* ignore */ }
  wss.close(() => httpServer.close(() => process.exit(0)))
  // Salida garantizada aunque queden handles abiertos.
  setTimeout(() => process.exit(0), 800).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Initialize DB then start
initDatabase().then(() => {
  httpServer.listen(PORT, HOST, () => {
    console.log(`[Server] Dashboard (loopback only): http://${HOST}:${PORT}`)
  })
}).catch(err => {
  console.error('[Server] Failed to initialize database:', err)
  process.exit(1)
})
