# 📚 Documentación Completa del Código — WhatsApp Team Sync

> Explicación detallada: **archivo por archivo, clase por clase, método por método**

---

## 📁 shared/types.ts — Tipos Compartidos

Este archivo define los **tipos de datos** que usan tanto la extensión como el servidor. Es como el **diccionario común** para que todos hablen el mismo idioma.

### 🔤 Tipos y Enums

| Nombre | Tipo | Valores | ¿Qué es? |
|--------|------|---------|----------|
| `AgentStatus` | `type` literal | `'active' \| 'paused' \| 'available' \| 'offline'` | Los 4 estados que puede tener un agente |

### 📦 Interfaces (moldes de datos)

#### `Agent` — Un vendedor/agente
```typescript
interface Agent {
  id: string           // ID único (ej: "Pedro-1705000-a1b2")
  name: string         // Nombre visible (ej: "Pedro")
  status: AgentStatus  // Estado actual
  contact: string|null // Nombre del cliente al que atiende (o null)
  color: string        // Color hex del avatar (ej: "#22C55E")
  lastSeen: number     // Timestamp última actividad
}
```

#### `PresenceUpdate` — Mensaje de actualización de presencia
```typescript
interface PresenceUpdate {
  type: 'PRESENCE_UPDATE'  // Tipo fijo
  agents: Agent[]           // Lista completa de agentes
}
```

#### `AttendingMessage` — Cuando un agente atiende un chat
```typescript
interface AttendingMessage {
  type: 'ATTENDING'
  agent: string      // Quién está atendiendo
  contact: string    // A quién atiende
  status: 'active'   // Siempre 'active'
}
```

#### `PausedMessage` — Cuando un agente se pausa
```typescript
interface PausedMessage {
  type: 'PAUSED'
  agent: string      // Quién se pausa
  reason?: string    // Razón opcional (ej: "user_paused")
}
```

#### `AvailableMessage` — Cuando un agente vuelve a estar disponible
```typescript
interface AvailableMessage {
  type: 'AVAILABLE'
  agent: string
}
```

#### `OfflineMessage` — Cuando un agente se desconecta
```typescript
interface OfflineMessage {
  type: 'OFFLINE'
  agent: string
}
```

#### `DeleteAgentMessage` — Cuando se elimina un agente
```typescript
interface DeleteAgentMessage {
  type: 'DELETE_AGENT'
  agent: string
}
```

#### `ServerInfoMessage` — Información inicial del servidor
```typescript
interface ServerInfoMessage {
  type: 'SERVER_INFO'
  version: string     // Versión del servidor (ej: "1.0.0")
  agents: Agent[]     // Lista de agentes conectados
}
```

#### `ErrorMessage` — Error del servidor
```typescript
interface ErrorMessage {
  type: 'ERROR'
  code: string        // Código (ej: "AUTH_REQUIRED", "PARSE_ERROR")
  message: string     // Texto descriptivo
}
```

### 🔀 Tipos Unión

| Nombre | Incluye |
|--------|---------|
| `ClientToServerMessage` | `AttendingMessage \| PausedMessage \| AvailableMessage \| OfflineMessage \| DeleteAgentMessage` |
| `ServerToClientMessage` | `PresenceUpdate \| ServerInfoMessage \| ErrorMessage` |
| `WSMessage` | `ClientToServerMessage \| ServerToClientMessage` |

### 🛡️ Type Guards (funciones que verifican el tipo de mensaje)

Cada una recibe un `WSMessage` y devuelve `true` si es de ese tipo:

```typescript
isAttendingMessage(msg)  // → true si msg.type === 'ATTENDING'
isPausedMessage(msg)     // → true si msg.type === 'PAUSED'
isAvailableMessage(msg)  // → true si msg.type === 'AVAILABLE'
isOfflineMessage(msg)    // → true si msg.type === 'OFFLINE'
isDeleteAgentMessage(msg) // → true si msg.type === 'DELETE_AGENT'
isPresenceUpdate(msg)    // → true si msg.type === 'PRESENCE_UPDATE'
isServerInfo(msg)        // → true si msg.type === 'SERVER_INFO'
isErrorMessage(msg)      // → true si msg.type === 'ERROR'
```

### 🎨 Diccionarios de Colores y Etiquetas

```typescript
STATUS_COLORS = {
  active:    '#ef4444',   // Rojo
  paused:    '#f59e0b',   // Amarillo
  available: '#22c55e',   // Verde
  offline:   '#9ca3af'    // Gris
}

STATUS_LABELS = {
  active:    'Atendiendo',
  paused:    'Pausado',
  available: 'Disponible',
  offline:   'Desconectado'
}
```

---

## 📁 server/src/types.ts — Tipos del Servidor

> **⚠️ NOTA:** Es una copia IDÉNTICA de `shared/types.ts`. El servidor la necesita porque usa `module: "NodeNext"` y no puede importar de `shared/` directamente sin configuración extra.

---

## 📁 server/src/server.ts — Servidor WebSocket

**Importaciones:**
- `WebSocketServer, WebSocket` del paquete `ws`
- `RoomManager` de `./rooms.js`
- Funciones type-guard de `./types.js`

### Variables Globales

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `PORT` | `process.env.PORT \|\| 3001` | Puerto del servidor (configurable por variable de entorno) |
| `HEARTBEAT_INTERVAL` | `30000` | 30 segundos entre heartbeats |
| `roomManager` | `new RoomManager()` | Instancia única que gestiona agentes |

### Flujo Principal

```
1. Crear WebSocketServer en el puerto
2. Cada 30s → roomManager.checkHeartbeats()
3. Por cada conexión entrante:
   a. Enviar mensaje WELCOME
   b. Esperar primer mensaje (debe ser ATTENDING con agent name)
   c. Si es válido → roomManager.register() → autenticado
   d. Si no → enviar ERROR AUTH_REQUIRED
   e. Si ya autenticado → roomManager.handleMessage()
   f. Al cerrar → roomManager.disconnect()
4. Graceful shutdown con SIGINT/SIGTERM
```

### Eventos del WebSocket

#### `connection` — Nueva conexión
```
- Crea variables: agentId = null, isAuthenticated = false
- Envía WELCOME
- Configura handlers para: message, close, error
- Inicia ping cada 30s
```

#### `message` — Llega un mensaje
```
1. Parsear JSON
2. Si NO autenticado:
   → Debe ser ATTENDING con agent
   → Si ok: register() + sendInitialState()
   → Si no: ERROR
3. Si autenticado:
   → roomManager.handleMessage(agentId, message)
```

#### `close` — Se cierra conexión
```
→ roomManager.disconnect(agentId)
→ Limpiar pingInterval
```

---

## 📁 server/src/rooms.ts — RoomManager (Gestión de Salas)

### Interfaces Internas

```typescript
interface ClientConnection {
  ws: WebSocket          // La conexión activa
  agentName: string      // Nombre del agente
  agentId: string        // ID único del agente
}
```

### Clase: `RoomManager`

Gestiona dos Mapas:
- `agents`: `Map<string, Agent>` — Datos de cada agente (id → Agent)
- `connections`: `Map<string, ClientConnection>` — Conexiones activas (id → ClientConnection)

#### Método: `generateAgentId(name)`
```
Propósito: Crear un ID único para cada agente
Formato: nombre + timestamp + 4 caracteres aleatorios
Ejemplo: "Pedro-1705000123456-a1b2"
```

#### Método: `register(ws, name)`
```
Propósito: Registrar un agente nuevo o reconectar uno existente

Pasos:
1. Buscar si ya hay un agente con el mismo nombre
2. Si existe:
   a. Guardar la nueva conexión (remplaza la anterior)
   b. Cerrar la conexión vieja si es diferente
   c. Reusar el mismo agente, marcar como 'available'
   d. Broadcast presencia
   e. Devolver ID existente
3. Si no existe:
   a. Generar nuevo ID
   b. Crear nuevo Agent con status 'available'
   c. Guardar en agents y connections
   d. Broadcast presencia
   e. Devolver nuevo ID
```

#### Método: `handleMessage(agentId, message)`
```
Propósito: Procesar mensajes de un agente autenticado

Según el tipo:
- ATTENDING  → status = 'active', contact = message.contact
- PAUSED     → status = 'paused', contact = null
- AVAILABLE  → status = 'available', contact = null
- OFFLINE    → status = 'offline', contact = null
- DELETE_AGENT → Eliminar de agents y connections

Siempre actualiza lastSeen = Date.now()
Siempre hace broadcastPresence() al final
```

#### Método: `disconnect(agentId)`
```
Propósito: Manejar desconexión de un agente

Pasos:
1. Verificar si ya hay una conexión nueva que remplazó esta
   → Si la conexión actual está OPEN, no marcar offline (reconexión)
2. Si no hay remplazo: marcar agente como 'offline'
3. Eliminar de connections
4. Broadcast presencia
```

#### Método: `getAllAgents()`
```
Propósito: Devolver todos los agentes como array
→ Array.from(this.agents.values())
```

#### Método: `broadcastPresence()` (privado)
```
Propósito: Enviar la lista actualizada de agentes a TODOS los conectados

Pasos:
1. Obtener todos los agentes
2. Crear mensaje PRESENCE_UPDATE
3. Recorrer todas las conexiones
4. Si la conexión está OPEN, enviar el JSON
```

#### Método: `sendInitialState(agentId)`
```
Propósito: Enviar el estado completo a un agente que acaba de conectar

→ Envía SERVER_INFO con versión y lista de agentes
```

#### Método: `checkHeartbeats()`
```
Propósito: Verificar que los agentes sigan vivos

→ Si un agente no ha enviado actividad en > 60s y no está offline:
   - Marcarlo como offline
   - Broadcast presencia
```

---

## 📁 extension/src/background/service-worker.ts — BackgroundManager

### Constantes

| Constante | Valor | Descripción |
|-----------|-------|-------------|
| `STORAGE_KEY` | `'wts_agent_config'` | Clave en chrome.storage.local para guardar configuración |
| `MAX_RECONNECT_ATTEMPTS` | `10` | Máximo de intentos de reconexión |
| `RECONNECT_BASE_DELAY` | `1000` | 1 segundo base para backoff exponencial |
| `HEARTBEAT_INTERVAL` | `30000` | 30 segundos entre heartbeats al servidor |

### Interfaces Internas

```typescript
AgentConfig {
  agentName: string     // Nombre del agente
  serverUrl: string     // URL del servidor WebSocket
}

AgentState {
  name: string          // Nombre
  status: AgentStatus   // Estado
  contact: string|null  // Contacto atendiendo
  color: string         // Color
  lastSeen: number      // Última actividad
  tabId?: number        // ID de la pestaña (opcional)
}
```

### Clase: `BackgroundManager`

Es el **cerebro** de toda la extensión. Se encarga de:
- Gestionar la conexión WebSocket
- Recibir mensajes del popup y content scripts
- Enviar actualizaciones a todas las pestañas

#### Constructor: `constructor()`
```
→ Llama a this.init()
```

#### Método: `init()` (privado, async)
```
Propósito: Inicializar todo el sistema

Pasos:
1. loadConfig() — Cargar configuración guardada
2. Escuchar mensajes de chrome.runtime
3. Detectar cambios de pestaña activa
4. Auto-conectar si hay configuración guardada
```

---

### 📞 Comunicación con la Extensión

El SW escucha estos mensajes de `chrome.runtime.onMessage`:

| Mensaje | ¿Quién lo envía? | ¿Qué hace? |
|---------|------------------|------------|
| `CONNECT` | Popup | Guarda config y conecta WebSocket |
| `ATTENDING` | Popup | Envía estado 'active' al servidor |
| `PAUSED` | Popup | Envía estado 'paused' |
| `RESUMED` | Popup | Envía estado 'available' |
| `AVAILABLE` | Popup | Envía estado 'available' |
| `CONTACT_CHANGED` | Content | Actualiza el contacto que se atiende |
| `UPDATE_SERVER_URL` | Options | Cambia URL del servidor y reconecta |
| `GET_AGENTS` | Cualquiera | Devuelve lista de agentes |
| `CONTENT_READY` | Content | Envía estado actual a la pestaña |
| `POPUP_READY` | Popup | Configura agente y conecta |
| `GET_CONNECTION_STATUS` | Popup | Devuelve estado de conexión |
| `DELETE_AGENT` | Popup/Content | Elimina agente |

---

### Métodos del WebSocket

#### `connect()` — Conectar al servidor
```
1. Verificar que haya configuración
2. No duplicar conexiones existentes
3. Crear nuevo WebSocket(url)
4. Asignar handlers: onopen, onmessage, onerror, onclose
```

#### `onOpen()` — Conexión establecida
```
1. Resetear contador de reconexión
2. Iniciar heartbeat
3. Broadcast CONNECTION_STATUS: true
4. Enviar primer mensaje ATTENDING al servidor
```

#### `onMessage(event)` — Llega mensaje del servidor
```
1. Parsear JSON
2. Según tipo: PRESENCE_UPDATE, SERVER_INFO, ERROR
```

#### `onError(error)` — Error de WebSocket
```
→ Solo loguea en consola
```

#### `onClose()` — Se cerró la conexión
```
1. Detener heartbeat
2. Broadcast CONNECTION_STATUS: false
3. Si no fue intencional → scheduleReconnect()
```

#### `scheduleReconnect()` — Reintentar conexión
```
1. Si ya se alcanzó el máximo → no hacer nada
2. Calcular delay = min(1000 * 2^intentos, 30000)
3. Esperar ese tiempo y reconectar
4. Incrementar intentos
```

#### `startHeartbeat()` — Iniciar latido
```
→ Cada 30s enviar HEARTBEAT si la conexión está abierta
```

#### `stopHeartbeat()` — Detener latido
```
→ Limpiar el interval
```

---

### 📡 Manejo de Mensajes del Servidor

#### `handleServerMessage(message)` — Procesar mensaje del servidor
```
Según tipo:
- PRESENCE_UPDATE → handlePresenceUpdate()
- SERVER_INFO → handleServerInfo()
- ERROR → loguear error
```

#### `handlePresenceUpdate(message)` — Actualizar lista de agentes
```
1. Recibir lista de agentes del servidor
2. Actualizar Map local de agentes
3. Eliminar agentes que ya no están en el servidor
4. Broadcast PRESENCE_UPDATE a todas las pestañas
```

#### `handleServerInfo(message)` — Recibir estado inicial
```
→ Delegar a handlePresenceUpdate con los agentes recibidos
```

---

### 🎮 Acciones del Agente

#### `handleAttending(contact)` — Atendiendo un chat
```
1. Actualizar estado local a 'active' con el contacto
2. Enviar ATTENDING al servidor
3. Broadcast local inmediato (para UI instantánea)
```

#### `handlePause()` — Pausar
```
1. Estado local → 'paused', contact = null
2. Enviar PAUSED al servidor
3. Broadcast local
```

#### `handleResume()` — Reanudar
```
1. Estado local → 'available', contact = null
2. Enviar AVAILABLE al servidor
3. Broadcast local
```

#### `handleAvailable()` — Disponible
```
→ Igual que handleResume() pero sin importar estado anterior
```

#### `handleContactChanged(contact)` — Cambió el contacto
```
1. Actualizar contacto en estado local
2. Si tiene contacto y no está pausado → ATTENDING
3. Si no tiene contacto y no está pausado → AVAILABLE
4. Broadcast local
```

---

### 🛠️ Métodos Auxiliares

#### `updateAgentState(name, updates)` — Actualizar estado de agente
```
→ Buscar agente por nombre y aplicar cambios parciales
→ Si no existe, crearlo
→ Siempre actualizar lastSeen = Date.now()
```

#### `getAllAgents()` — Obtener todos los agentes
```
→ Convertir el Map a Array de objetos planos
```

#### `getStatusColor(status)` — Color según estado
```
active → '#EF4444' (rojo)
paused → '#F59E0B' (amarillo)
available → '#22C55E' (verde)
offline → '#9CA3AF' (gris)
```

#### `send(message)` — Enviar mensaje al servidor
```
→ Si la conexión está OPEN, enviar JSON.stringify(message)
```

#### `broadcastToContent(message)` — Enviar a todas las pestañas
```
→ chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
→ A cada tab: chrome.tabs.sendMessage(tabId, message)
→ Ignorar errores (content script podría no estar listo)
```

#### `sendCurrentStateToTab(tabId)` — Enviar estado actual a una pestaña
```
Envía:
- PRESENCE_UPDATE (lista de agentes)
- CONNECTION_STATUS (conectado/desconectado)
- CURRENT_AGENT_NAME (nombre del agente actual)
```

#### `handlePopupReady(agentName)` — Popup listo
```
1. Si mismo nombre y ya conectado → no hacer nada
2. Cargar server URL de chrome.storage.sync
3. Si cambió el nombre:
   a. Enviar DELETE_AGENT con nombre viejo
   b. Desconectar intencionalmente
4. Guardar nueva config
5. Conectar
```

#### `disconnect()` — Desconexión intencional
```
1. Marcar isIntentionallyClosed = true
2. Detener heartbeat
3. Cerrar WebSocket
4. Broadcast CONNECTION_STATUS: false
```

#### `handleDeleteAgent(agentName)` — Eliminar agente
```
1. Solo permite eliminarse a sí mismo
2. Eliminar del Map local
3. Broadcast presencia actualizada
4. Enviar OFFLINE al servidor
```

---

## 📁 extension/src/content/index.ts — WhatsAppTeamSync (Content Script)

Es el **punto de entrada** del script que se inyecta en WhatsApp Web.

### Clase: `WhatsAppTeamSync`

#### Constructor: `constructor()`
```
1. Crear DomObserver
2. Crear ContactDetector
3. Crear FloatingPanel
4. Llamar init()
```

#### Método: `init()` (privado, async)
```
1. waitForWhatsAppReady() — Esperar a que WhatsApp cargue
2. setupEventListeners() — Configurar escuchas
3. notifyBackgroundReady() — Avisar al SW que estamos listos
4. requestAgentName() — Pedir nombre del agente
```

#### Método: `waitForWhatsAppReady()` (privado)
```
Propósito: Esperar a que aparezca la lista de chats de WhatsApp

→ Usa requestAnimationFrame para verificar cada frame
→ Resuelve cuando encuentra div[data-testid="chat-list"]
```

#### Método: `setupEventListeners()` (privado)
```
Conecta:
1. DomObserver.onChatSelect → cuando selecciona un chat
2. DomObserver.onChatDeselect → cuando deselecciona
3. ContactDetector.startObserving → cambios en el contacto actual
4. chrome.runtime.onMessage → mensajes del SW
```

#### Método: `onChatSelected(contactName, chatElement)` (privado, async)
```
→ Si no hay nombre, detectarlo con ContactDetector
→ Actualizar currentContact
→ Enviar CONTACT_CHANGED al SW
```

#### Método: `onChatDeselected()` (privado)
```
→ currentContact = null
→ Enviar CONTACT_CHANGED con null
```

#### Método: `updateBackgroundContact(contact)` (privado)
```
→ chrome.runtime.sendMessage({ type: 'CONTACT_CHANGED', contact })
```

#### Método: `handleBackgroundMessage(message)` (privado)
```
Según tipo:
- PRESENCE_UPDATE → floatingPanel.updateAgents()
- CONNECTION_STATUS → floatingPanel.updateServerStatus()
- AGENT_STATUS → actualizar isPaused y panel
- CURRENT_AGENT_NAME → guardar nombre y config
- CONFIG → guardar configuración
```

#### Método: `notifyBackgroundReady()` (privado)
```
→ Enviar CONTENT_READY al SW
```

#### Método: `requestAgentName()` (privado)
```
→ Enviar GET_AGENT_NAME (⚠️ Este mensaje NO es manejado por el SW)
```

---

## 📁 extension/src/content/floating-panel.ts — FloatingPanel

Este es el **panel visual** que se muestra sobre WhatsApp Web.

### Constantes de CSS (en `getStyles()`)

Variables CSS personalizadas:
```
--wts-primary: #25D366           (verde WhatsApp)
--wts-bg: #ffffff                (fondo)
--wts-text: #1F2937              (texto)
--wts-border: #E5E7EB            (borde)
--wts-shadow: 0 8px 32px...      (sombra)
--wts-active: #EF4444            (rojo atendiendo)
--wts-paused: #F59E0B            (amarillo pausado)
--wts-available: #22C55E         (verde disponible)
--wts-offline: #9CA3AF           (gris desconectado)
```

Soporta:
- Modo oscuro automático (`prefers-color-scheme: dark`)
- Animaciones CSS (`scale`, `opacity`, `transform`)
- Reducción de movimiento (`prefers-reduced-motion`)
- Scrollbar personalizada

### Clase: `FloatingPanel`

#### Constructor: `constructor()`
```
→ Llama a this.init()
```

#### Método: `init()` (privado)
```
1. Crear elemento host <div> con position: fixed
2. Adjuntar Shadow DOM
3. injectStyles() — meter CSS dentro del shadow
4. render() — crear estructura HTML
5. bindEvents() — conectar eventos
6. loadCollapsedState() — restaurar estado guardado
```

#### Método: `injectStyles()` (privado)
```
→ Crea <style> y lo mete en el Shadow DOM con todos los estilos
```

#### Método: `render()` (privado)
```
Construye:
<div class="wts-panel">
  <div class="wts-header">
    <h3><span class="wts-logo">W</span> WhatsApp Team Sync</h3>
    <button toggle>← flecha</button>
  </div>
  <div class="wts-agents">
    <div class="wts-empty">Cargando agentes...</div>
  </div>
  <div class="wts-server-status">
    ⚠️ Conectando al servidor...
  </div>
</div>
<button class="wts-collapsed-badge hidden">
  → 0
</button>
```

#### Método: `bindEvents()` (privado)
```
Botón toggle → toggleCollapse()
Badge colapsado → toggleCollapse()
Tecla Escape → collapse()
```

#### Método: `loadCollapsedState()` (privado)
```
→ Lee localStorage('wts_panel_collapsed')
→ Si 'true', colapsa el panel
```

#### Método: `saveCollapsedState()` (privado)
```
→ Guarda en localStorage el estado actual
```

#### Método: `toggleCollapse()` — Alternar colapso
```
Si colapsado → expand()
Si expandido → collapse()
```

#### Método: `expand()` — Expandir panel
```
→ Quitar clase 'collapsed'
→ Ocultar badge
→ Actualizar ícono
```

#### Método: `collapse()` — Colapsar panel
```
→ Agregar clase 'collapsed'
→ Mostrar badge
→ Actualizar ícono
```

#### Método: `updateToggleIcon()` (privado)
```
→ Cambiar la flecha según estado (← expandido, → colapsado)
```

---

### 🖥️ API Pública del Panel

#### `updateAgents(agents)` — Actualizar lista de agentes
```
Propósito: Renderizar la lista de agentes en el panel

1. Si no hay agentes → mostrar "No hay agentes conectados"
2. Por cada agente, crear:
   - Avatar circular con inicial (color según status)
   - Nombre
   - Punto de color (verde/rojo/amarillo/gris)
   - Estado + contacto
   - Botón eliminar (solo para el usuario actual)
3. Si es el usuario actual → clase 'current-user'
4. Conectar eventos de los botones eliminar
5. Actualizar contador del badge
```

#### `updateCurrentUserStatus(status)` — Estado del usuario actual
```
→ Buscar elemento .wts-agent.current-user
→ Actualizar su punto de color y etiqueta
```

#### `updateCurrentUserName(name)` — Nombre del usuario
```
→ Guardar this.currentAgentName = name
```

#### `updateServerStatus(connected)` — Estado del servidor
```
Si conectado:
  - Clase 'connected'
  - Ícono checkmark ✓
  - Texto: "Conectado al servidor"
Si desconectado:
  - Sin clase 'connected'
  - Ícono warning ⚠️
  - Texto: "Servidor desconectado - Reintentando..."
```

#### `updateBadgeCount(count)` — Contador del badge
```
→ Actualiza el número en el badge colapsado
```

#### `getStatusClass(status)` — Clase CSS según estado
```
active → 'active', paused → 'paused', etc.
```

#### `getStatusLabel(status)` — Etiqueta en español
```
active → 'Atendiendo', paused → 'Pausado', etc.
```

#### `getStatusColor(status)` — Color hex
```
active → '#EF4444', paused → '#F59E0B', etc.
```

#### `escapeHtml(text)` — Sanitizar HTML
```
→ Usa innerText para escapar caracteres peligrosos
```

#### `deleteAgent(agentName)` — Eliminar agente
```
→ Confirm() nativo
→ Enviar DELETE_AGENT al SW
```

---

## 📁 extension/src/content/dom-observer.ts — DomObserver

### Interfaces

```typescript
ChatSelectEvent {
  type: 'chat-selected'
  contactName: string | null
  chatElement: HTMLElement
}
```

### Clase: `DomObserver`

Observa la lista de chats de WhatsApp Web para detectar cuándo un agente selecciona un chat.

#### Constantes
```
CHAT_LIST_SELECTOR = 'div[data-testid="chat-list"]'
CHAT_ITEM_SELECTOR = 'div[data-testid="cell-frame-container"]'
```

#### Constructor: `constructor()`
```
→ Llama a init()
```

#### Método: `init()` (privado)
```
1. Esperar DOMContentLoaded si es necesario
2. startObserving()
3. observeUrlChanges() — detectar cambios de URL (SPA)
```

#### Método: `startObserving()` (privado)
```
1. Buscar la lista de chats
2. Si no existe → reintentar en 1 segundo
3. Crear MutationObserver en la lista de chats
4. Observar: childList, subtree, attributes (aria-selected, tabindex, class)
5. Agregar click listeners a los items del chat
```

#### Método: `handleMutations(mutations)` (privado)
```
Por cada mutación:
- Si es attribute y un chat fue seleccionado → handleChatSelection()
- Si es childList y un nuevo elemento está seleccionado → handleChatSelection()
- Siempre → scheduleDeselectionCheck()
```

#### Método: `isChatSelected(element)` (privado)
```
→ true si: aria-selected="true" O tiene data-selected O clase 'selected' O tabindex="0"
```

#### Método: `handleChatSelection(chatElement)` (privado)
```
→ Con debounce de 100ms
→ Si es el mismo chat, ignorar
→ Emitir evento 'chat-selected'
```

#### Método: `handleChatDeselection()` (privado)
```
→ Si había un chat seleccionado, emitir 'chat-deselected'
→ Con debounce de 300ms para evitar falsos positivos
```

#### Método: `emitChatSelected(chatElement)` (privado)
```
→ Extraer nombre del contacto
→ Llamar a todos los callbacks de selección
```

#### Método: `emitChatDeselected()` (privado)
```
→ Llamar a todos los callbacks de deselección
```

#### Método: `extractContactNameFromChatItem(chatElement)` (privado)
```
Busca el nombre del contacto con múltiples selectores de fallback:
1. span[data-testid="cell-frame-title"]
2. span[dir="auto"][title]
3. div[data-testid="cell-frame-title"]
4. span._2wUmf (clase legacy de WhatsApp)
5. span[title]
Devuelve el texto o null
```

#### Método: `addClickListeners(chatList)` (privado)
```
→ Escuchar clicks en la lista de chats
→ Si se hizo clic en un chat → handleChatSelection() con 50ms de delay
```

#### Método: `observeUrlChanges()` (privado)
```
→ Observar cambios en location.href (las SPAs cambian la URL sin recargar)
→ Si cambia → reiniciar observer
```

#### Método: `restart()` — Reiniciar
```
→ stopObserving() + startObserving() con 500ms delay
```

#### Método: `stopObserving()` — Detener observación
```
→ Desconectar MutationObserver
→ Limpiar timers de debounce
```

#### Método: `onChatSelect(callback)` — Suscribirse a selección
```
→ Agregar callback a la lista
→ Devolver función para desuscribirse
```

#### Método: `onChatDeselect(callback)` — Suscribirse a deselección
```
→ Igual que onChatSelect
```

#### Método: `isActive()` — ¿Está observando?
```
→ true/false
```

---

## 📁 extension/src/content/contact-detector.ts — ContactDetector

### Clase: `ContactDetector`

Detecta y extrae el nombre del contacto activo en WhatsApp Web.

#### Selectores
```
CONVERSATION_PANEL_SELECTOR = 'div[data-testid="conversation-panel-wrapper"]'
CHAT_TITLE_SELECTOR = 'header span[data-testid="conversation-info-header-chat-title"]'
BUSINESS_BADGE_SELECTOR = 'span[data-testid="verified-badge"]'
```

#### Constructor: `constructor()`
```
→ Llama a init()
```

#### Método: `init()` (privado)
```
→ Esperar DOMContentLoaded → startObserving() sin callback
```

#### Método: `detectCurrentContact()` (async)
```
Propósito: Detectar el contacto actual activamente

1. Esperar 500ms para que el DOM se estabilice
2. extractContactName()
3. Si hay contacto → actualizar current y lastKnown
4. Si no hay pero existe el panel → devolver el último conocido
```

#### Método: `extractContactName()` (privado)
```
1. Buscar el panel de conversación
2. Dentro, buscar el título del chat
3. Si existe ✓ badge de empresa → "✓ Nombre"
4. Devolver nombre o null
```

#### Método: `startObserving(callback)` — Empezar a observar
```
1. Guardar callback
2. Crear MutationObserver en el panel de conversación
3. Si cambia childList o characterData → detectar nuevo contacto
4. Si el panel no existe → startPollingForPanel()
```

#### Método: `startPollingForPanel()` (privado)
```
→ Cada 500ms buscar el panel
→ Cuando aparezca, empezar a observarlo
```

#### Método: `stopObserving()` — Dejar de observar
```
→ Desconectar observer y detener polling
```

#### Método: `getCurrentContact()` — Contacto actual
```
→ Devuelve this.currentContact
```

#### Método: `getLastKnownContact()` — Último contacto conocido
```
→ Devuelve this.lastKnownContact (aunque se haya ido)
```

---

## 📁 extension/src/popup/popup.ts — Popup de la Extensión

### Constantes

| Constante | Valor | Descripción |
|-----------|-------|-------------|
| `DEFAULT_SERVER_URL` | `'ws://localhost:3001'` | URL por defecto del servidor |
| `AGENT_LIST_KEY` | `'wts_agent_list'` | Clave storage para lista de agentes |
| `CONFIG_KEY` | `'wts_agent_config'` | Clave storage para configuración activa |
| `DEFAULT_AGENTS` | `['Agente 1', 'Agente 2', 'Agente 3']` | Agentes precargados |

### Variables Globales

| Variable | Descripción |
|----------|-------------|
| `currentConfig` | Configuración activa (agentName + serverUrl) o null |
| `agentList` | Lista de nombres de agentes disponibles |
| `isPaused` | Si el agente actual está pausado |

### Funciones de Storage

#### `loadConfig()` (async)
```
→ Lee chrome.storage.local.get(CONFIG_KEY)
→ Devuelve AgentConfig o null
```

#### `saveConfig(config)`
```
→ Guarda en chrome.storage.local
```

#### `loadAgentList()` (async)
```
→ Lee lista de agentes
→ Si no existe, guarda los DEFAULT_AGENTS
```

#### `saveAgentList(list)`
```
→ Guarda lista de agentes
```

### Funciones de Vista

#### `showView(view)`
```
Muestra/oculta las vistas:
- 'setup' → formulario de selección
- 'connected' → panel de control
- 'error' → pantalla de error
```

#### `updateStatus(connected, connecting?)`
```
Actualiza el indicador de estado:
- connecting → punto amarillo pulsante
- connected → punto verde
- disconnected → punto rojo
```

#### `updateBadge(status)`
```
Actualiza la etiqueta de estado:
- 'Disponible' → badge verde
- 'Pausado' → badge amarillo
- 'Atendiendo' → badge rojo
- Otro → badge gris
```

#### `setServerWarning(show)`
```
→ Muestra/oculta advertencia de servidor desconectado
```

### Funciones de Lista de Agentes

#### `renderAgentList()`
```
→ Renderiza la lista de agentes con:
  - Avatar circular con inicial (color cíclico)
  - Nombre del agente
  - Botón eliminar (X)
→ Cada agente es clickeable para seleccionar
→ Botón eliminar para borrar de la lista
```

#### `selectAgent(name)`
```
1. Crear config: { agentName: name, serverUrl: DEFAULT_SERVER_URL }
2. Guardar config
3. Mostrar vista 'connected'
4. Mostrar "Conectando..."
5. Enviar POPUP_READY al SW
```

#### `deleteAgent(name)`
```
→ Filtrar el agente de la lista
→ Guardar lista actualizada
→ Re-renderizar
```

### Inicialización

#### `init()` (async)
```
1. Cargar config actual
2. Cargar lista de agentes
3. Si hay un agente configurado:
   a. Mostrar 'connected' con su nombre
   b. Preguntar al SW estado de conexión
   c. Enviar POPUP_READY
4. Si no:
   a. Renderizar lista de agentes
   b. Mostrar 'setup'
```

### Event Listeners (en DOMContentLoaded)

#### Botones de Añadir Agente
```
- add-agent-btn → muestra formulario
- confirm-add-btn → añade agente a la lista
- cancel-add-btn → oculta formulario
- Enter en input → confirma
- Escape en input → cancela
```

#### Botón de Conexión Personalizada
```
- connect-custom-btn → conecta con nombre escrito
- Enter en input → conecta
```

#### Botones de Vista Conectada
```
- change-agent-btn → vuelve a vista 'setup'
- pause-btn → envía PAUSED, oculta pause, muestra resume
- resume-btn → envía RESUMED, oculta resume, muestra pause
```

#### Mensajes del Background
```
Escucha:
- CONNECTION_STATUS → actualiza estado y badge
- AGENT_STATUS → actualiza badge
- SERVER_DISCONNECTED → muestra warning y desactiva botones
```

---

## 📁 extension/src/options/options.ts — Página de Opciones

### Constantes

| Constante | Valor |
|-----------|-------|
| `SERVER_URL_KEY` | `'wts_server_url'` |
| `DEFAULT_SERVER_URL` | `'ws://localhost:3001'` |

### Variables (referencias a elementos del DOM)

| Variable | Elemento |
|----------|----------|
| `serverUrlInput` | `#server-url` (input) |
| `saveBtn` | `#save-server` (button) |
| `testBtn` | `#test-connection` (button) |
| `resultDiv` | `#connection-result` (div) |
| `versionEl` | `#version` (span) |
| `serverStatusEl` | `#server-status` (span) |
| `resetBtn` | `#reset-all` (button) |

### Funciones

#### `loadSettings()` (async)
```
1. Cargar server URL de chrome.storage.sync
2. Mostrar en el input
3. Mostrar versión de la extensión
4. Verificar estado del servidor
```

#### `saveSettings()` (async)
```
1. Validar que la URL no esté vacía
2. Validar que sea ws:// o wss://
3. Guardar en chrome.storage.sync
4. Enviar UPDATE_SERVER_URL al SW
5. Verificar estado
```

#### `testConnection()` (async)
```
1. Validar URL
2. Crear WebSocket de prueba
3. Timeout de 5 segundos
4. Mostrar resultado (éxito/error)
```

#### `testWebSocket(url)` (función interna, async)
```
→ Crea WebSocket temporal
→ Timeout 5s
→ Resuelve true si onopen, false si onerror o timeout
```

#### `updateServerStatus()` (async)
```
→ Prueba conexión con la URL guardada
→ Muestra "Conectado" o "Desconectado"
```

#### `showResult(type, message)`
```
Muestra mensaje estilizado:
- success → verde
- error → rojo
- info → azul
```

#### `resetAll()` (async)
```
1. Confirmar con el usuario
2. Limpiar chrome.storage.sync
3. Restaurar URL por defecto
4. Notificar al SW
```

### Event Listeners
```
saveBtn → saveSettings()
testBtn → testConnection()
resetBtn → resetAll()
Enter en input → saveSettings()
```

---

## 📁 extension/public/manifest.json — Manifest V3

```json
{
  "name": "WhatsApp Team Sync",
  "version": "1.0.0",
  "manifest_version": 3,
  
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "WhatsApp Team Sync",
    "default_icon": { "16": "icons/icon-16.svg", ... }
  },
  
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  
  "content_scripts": [{
    "matches": ["https://web.whatsapp.com/*"],
    "js": ["content/index.js"],
    "css": ["content/styles.css"],
    "run_at": "document_idle"
  }],
  
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["https://web.whatsapp.com/*"]
}
```

### Secciones Clave

| Campo | Descripción |
|-------|-------------|
| `manifest_version: 3` | Versión más moderna de extensiones Chrome |
| `action.default_popup` | HTML que se abre al hacer clic en el icono |
| `background.service_worker` | Script que corre en segundo plano (siempre vivo) |
| `content_scripts` | Scripts que se inyectan en WhatsApp Web |
| `run_at: document_idle` | Se ejecuta cuando la página terminó de cargar |
| `permissions: storage` | Puede guardar datos localmente |
| `host_permissions` | Solo funciona en web.whatsapp.com |

---

## 📁 vite.config.ts — Configuración de Build

### Plugins

#### Plugin: `copy-public-assets` (custom)
```
closeBundle() — se ejecuta después del build:

1. copyDir('extension/public', 'dist')
   → Copia íconos y manifest.json

2. copyHtmlEntryFiles()
   → Copia los HTML (popup, options, content, background)

3. copyCssToFolders()
   → Mueve los CSS a las carpetas correctas
```

### Configuración de Build

| Opción | Valor | Descripción |
|--------|-------|-------------|
| `outDir` | `'dist'` | Carpeta de salida |
| `emptyOutDir` | `true` | Limpia dist antes de build |
| `minify` | `false` | No minificar (para debug) |
| `sourcemap` | `true` | Generar sourcemaps |

### Entradas (inputs)

```
'content/index'         → extension/src/content/index.ts
'background/service-worker' → extension/src/background/service-worker.ts
'popup/popup'           → extension/src/popup/popup.ts
'options/options'       → extension/src/options/options.ts
```

### Aliases
```
'@'         → extension/src/
'@shared'   → shared/
```

---

## 📁 package.json — Dependencias

### Scripts

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Build en modo watch (desarrollo) |
| `npm run build` | Build en modo producción |
| `npm run server` | Inicia el servidor Node |
| `npm run dev:all` | Build + servidor al mismo tiempo |
| `npm run build:server` | Compila el servidor TypeScript |

### Dependencias (devDependencies)

| Paquete | Versión | Para qué sirve |
|---------|---------|----------------|
| `typescript` | ^5.3.0 | Compilador TS |
| `vite` | ^5.0.0 | Bundler (empaquetador) |
| `ws` | ^8.16.0 | WebSocket para Node (servidor) |
| `@types/chrome` | ^0.0.268 | Tipos de Chrome API |
| `@types/ws` | ^8.5.10 | Tipos de WebSocket |
| `@types/node` | ^20.10.0 | Tipos de Node.js |
| `concurrently` | ^8.2.2 | Correr varios scripts a la vez |

---

## 📁 extension/src/content/styles.css — Estilos del Content Script

### Estilos Globales

| Selector | Propósito |
|----------|-----------|
| `#wts-root` | Contenedor principal (fixed, z-index máximo) |
| `.wts-panel` | Panel flotante con animación slide-in |
| `.wts-panel.collapsed` | Estado colapsado con slide-out |
| `.wts-collapsed-badge` | Badge que se muestra cuando está colapsado |

### Media Queries

| Query | Ajuste |
|-------|--------|
| `prefers-reduced-motion` | Desactiva todas las animaciones |
| `prefers-contrast: high` | Bordes más gruesos para contraste |
| `prefers-color-scheme: dark` | Variables de color modo oscuro |

---

## 📁 extension/src/popup/popup.css — Estilos del Popup

### Variables CSS

| Variable | Valor | Uso |
|----------|-------|-----|
| `--primary` | `#25D366` | Verde WhatsApp (acciones principales) |
| `--danger` | `#EF4444` | Rojo (eliminar) |
| `--warning` | `#F59E0B` | Amarillo (pausa) |
| `--border` | `#E5E7EB` | Bordes suaves |
| `--shadow` | Drop shadow | Sombras |

### Componentes

| Clase | Descripción |
|-------|-------------|
| `.agent-item` | Item de la lista de agentes |
| `.agent-avatar` | Círculo con inicial del nombre |
| `.badge-*` | Etiquetas de estado (verde/rojo/amarillo/gris) |
| `.btn-*` | Botones (primary, secondary, pause, resume, change, add) |
| `.add-form` | Formulario para añadir agente |
| `.custom-name-row` | Input para nombre personalizado |
| `.server-status` | Advertencia de servidor desconectado |

### Animaciones

| Animación | Descripción |
|-----------|-------------|
| `pulse` | Parpadeo del indicador "Conectando..." |

---

## 📁 extension/src/options/options.css — Estilos de Opciones

### Componentes

| Clase | Descripción |
|-------|-------------|
| `.card` | Tarjetas de configuración |
| `.form-group` | Grupos de formulario con label |
| `.result.success/.error/.info` | Mensajes de resultado |
| `.info-grid` | Grid de información (2 columnas) |
| `.danger-zone` | Sección de peligro (borde rojo) |

---

## 📁 extension/public/manifest.json — Icons

La extensión usa archivos SVG como íconos en 3 tamaños:
- `icons/icon-16.svg` — Barra de direcciones
- `icons/icon-48.svg` — Gestor de extensiones
- `icons/icon-128.svg` — Chrome Web Store

---

## 🔄 Resumen del Flujo Completo de Datos

```
                  POPUP                        WHATSAPP WEB
              ┌──────────┐                  ┌──────────────┐
              │ 1. Elegir│                  │ 5. Abrir chat│
              │  agente  │                  │              │
              └────┬─────┘                  └──────┬───────┘
                   │ POPUP_READY                   │ DOM Observer
                   ▼                               ▼
          ┌────────────────┐             ┌──────────────────┐
          │  BACKGROUND     │◄────────────│  CONTENT SCRIPT  │
          │  Service Worker │ CONTACT_    │  (injected in    │
          │                │ CHANGED     │   WhatsApp)       │
          └───────┬────────┘             └────────┬─────────┘
                  │                               │
                  │ ATTENDING/                    │ PRESENCE_UPDATE
                  │ PAUSED/etc                   │ (UI update)
                  ▼                               ▼
          ┌────────────────┐             ┌──────────────────┐
          │   SERVIDOR     │             │  FLOATING PANEL  │
          │   WebSocket    │────────────►│  (en Whatsapp)   │
          │   (Node.js)    │ PRESENCE_   │                  │
          └────────────────┘ UPDATE      └──────────────────┘
```

---

## ⚠️ Problemas Detectados en el Código

### 🔴 Críticos

1. **Import roto en floating-panel.ts** (línea 3):
   ```typescript
   import type { Agent, AgentStatus } from '../shared/types.js'
   ```
   El content script está en `extension/src/content/`, entonces `../shared/types.js` resuelve a `extension/shared/types.js`, que **no existe** (está en `shared/types.ts`). Debería ser `../../shared/types.js` o usar el alias `@shared`.

2. **WebSocket no importado en rooms.ts**:
   ```typescript
   if (currentConn && currentConn.ws.readyState === WebSocket.OPEN) {
   ```
   Usa `WebSocket.OPEN` pero no importa `WebSocket` de ningún lado. Debería importarlo de `ws`.

### 🟡 Medios

3. **GET_AGENT_NAME sin manejador**: El content script envía `GET_AGENT_NAME` pero el SW no lo procesa.

4. **HEARTBEAT no tipado en servidor**: El cliente envía `HEARTBEAT` pero en `rooms.ts` no hay case para ese tipo. Se ignora silenciosamente.

5. **shared/types.js incompleto**: No exporta `isDeleteAgentMessage`.

6. **Tipos duplicados**: `shared/types.ts` y `server/src/types.ts` son copias exactas.

### 🟢 Bajos

7. **Uso de `confirm()` nativo**: Podría no funcionar en algunos contextos de Chrome.
8. **Sin tests**: El proyecto no tiene tests unitarios ni de integración.

---

*Documentación generada automáticamente con análisis del código fuente.*
