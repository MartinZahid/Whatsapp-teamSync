// Web terminal (PTY) over WebSocket with persistent sessions.
//
// Sessions are keyed by the auth token so that WebSocket reconnects (mobile
// network blips, browser backgrounding, etc.) re-attach to the SAME shell
// instead of spawning a fresh one. A shell that exits/misbehaves is
// automatically respawned, so the terminal never shows a hard disconnect.
import { WebSocket } from 'ws'
import { spawn, IPty } from 'node-pty'

const SIZE_RE = /^\x00(\d*)x(\d*)$/

// Grace period after the last client disconnects before we destroy the shell.
const SESSION_KEEP_MS = 60_000
// Flush batched PTY output early if it grows beyond this (avoid giant frames).
const MAX_BATCH_BYTES = 256 * 1024

interface TerminalSession {
  key: string
  clients: Set<WebSocket>
  pty: IPty | null
  killTimer: NodeJS.Timeout | null
  alive: boolean
}

const sessions = new Map<string, TerminalSession>()

function parseSize(data: Buffer): { cols: number; rows: number } | null {
  if (data.length < 3 || data[0] !== 0x00) return null
  const m = data.toString().match(SIZE_RE)
  if (!m) return null
  const cols = parseInt(m[1], 10)
  const rows = parseInt(m[2], 10)
  if (!cols || !rows) return null
  return { cols, rows }
}

// Coalesce the many tiny PTY chunks into fewer WebSocket frames. Each realm
// reads one frame per tick instead of dozens of micro-frames.
function makeBatcher(forward: (payload: string) => void): (data: string) => void {
  let buffer: string[] = []
  let len = 0
  let scheduled = false

  const flush = () => {
    scheduled = false
    if (buffer.length === 0) return
    const payload = buffer.join('')
    buffer = []
    len = 0
    forward(payload)
  }

  return (data) => {
    buffer.push(data)
    len += data.length
    if (!scheduled) {
      scheduled = true
      setImmediate(flush)
    } else if (len >= MAX_BATCH_BYTES) {
      flush()
    }
  }
}

function broadcast(session: TerminalSession, data: string): void {
  session.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data)
      } catch (err) {
        console.error('[Terminal] send error:', err)
      }
    }
  })
}

function spawnShell(session: TerminalSession): void {
  if (session.pty || !session.alive) return
  const shell = process.env.SHELL || '/bin/bash'
  const cwd = process.env.HOME || '/'
  const opts = {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', LANG: 'C.UTF-8' },
  }
  // Envuelve el shell en una sesión tmux persistente: sobrevive a la
  // desconexión del móvil y a los reinicios del server (con KillMode=process).
  // TERMINAL_TMUX=0 desactiva el envoltorio y usa el shell directo.
  const tmuxEnv = process.env.TERMINAL_TMUX
  const useTmux = tmuxEnv !== '0'
  const tmuxName = tmuxEnv || 'coffecode'
  let pty: IPty | null = null
  if (useTmux) {
    try {
      pty = spawn('tmux', ['new-session', '-A', '-s', tmuxName], opts)
    } catch (err) {
      console.error('[Terminal] tmux no disponible, usando shell directo:', err)
      pty = null
    }
  }
  if (!pty) {
    try {
      pty = spawn(shell, [], opts)
    } catch (err) {
      console.error('[Terminal] Failed to spawn shell:', err)
      return
    }
  }
  session.pty = pty
  const out = makeBatcher((payload) => broadcast(session, payload))

  pty.onData((data) => {
    if (session.alive) out(data)
  })

  pty.onExit(({ exitCode }) => {
    console.log(`[Terminal] shell exited (code ${exitCode}) — session ${session.key.slice(0, 8)}`)
    session.pty = null
    // The shell died (opencode crashing, bash exiting, kill). Keep the session
    // alive and respawn a fresh shell so clients never hard-disconnect.
    if (session.alive) {
      setTimeout(() => spawnShell(session), 400)
    }
  })
}

function destroySession(session: TerminalSession): void {
  session.alive = false
  if (session.killTimer) {
    clearTimeout(session.killTimer)
    session.killTimer = null
  }
  if (session.pty) {
    session.pty.kill()
    session.pty = null
  }
  session.clients.clear()
  sessions.delete(session.key)
}

// Cierra todas las sesiones (shutdown). Con tmux esto solo desconecta el
// cliente: la sesión tmux sigue viva y se reengancha al reiniciar.
export function closeAllTerminals(): void {
  for (const session of Array.from(sessions.values())) {
    try {
      destroySession(session)
    } catch {
      /* ignore */
    }
  }
}

export function attachTerminal(ws: WebSocket, sessionKey: string): () => void {
  let session = sessions.get(sessionKey)

  if (!session || !session.alive) {
    session = {
      key: sessionKey,
      clients: new Set(),
      pty: null,
      killTimer: null,
      alive: true,
    }
    sessions.set(sessionKey, session)
    spawnShell(session)
  }

  session.clients.add(ws)
  if (session.killTimer) {
    clearTimeout(session.killTimer)
    session.killTimer = null
  }
  console.log(`[Terminal] Sesión ${sessionKey.slice(0, 8)} → ${session.clients.size} cliente(s)`)

  const onClose = (reason?: string) => {
    session.clients.delete(ws)
    console.log(`[Terminal] Sesión ${sessionKey.slice(0, 8)} ← ${session.clients.size} cliente(s)${reason ? ` (${reason})` : ''}`)
    if (session.clients.size === 0) {
      if (session.killTimer) clearTimeout(session.killTimer)
      session.killTimer = setTimeout(() => {
        console.log(`[Terminal] Session ${sessionKey.slice(0, 8)} expirada por inactividad`)
        destroySession(session!)
      }, SESSION_KEEP_MS)
    }
  }

  ws.on('message', (data: Buffer) => {
    if (!session || !session.pty) return
    const resize = parseSize(data)
    if (resize) {
      try {
        session.pty.resize(resize.cols, resize.rows)
      } catch {
        /* pty may be gone */
      }
      return
    }
    if (data.length === 1 && data[0] === 0x04) {
      // Ctrl-D: if the shell closes, spawnShell respawns it.
      session.pty.write(data.toString('utf8'))
      return
    }
    session.pty.write(data.toString('utf8'))
  })

  ws.on('close', (code) => onClose(`code ${code}`))
  ws.on('error', (err) => onClose(`error ${err.message}`))

  return () => onClose('cleanup')
}