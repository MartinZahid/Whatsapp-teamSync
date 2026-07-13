# WhatsApp Team Sync

Extensión de Chrome para equipos de servicio al cliente que trabajan con WhatsApp Web. Muestra en tiempo real qué agente está atendiendo qué chat, quién está disponible y quién está pausado.

## Características

- **Presencia en tiempo real** — Panel flotante sobre WhatsApp Web que muestra el estado de cada agente
- **Detección automática de chats** — Detecta automáticamente cuando un agente abre un chat y muestra a quién está atendiendo
- **Estados**: Activo (atendiendo) 🔴, Disponible 🟢, Pausado 🟡
- **Agentes precargados** — Viene con 3 agentes por defecto, puedes añadir más o eliminar
- **Pausar/Reanudar** — Control manual desde el popup de la extensión
- **Persistencia** — Los agentes se reconectan automáticamente al mismo perfil
- **Shadow DOM** — Interfaz aislada que no interfiere con WhatsApp Web

## Stack

- **Extensión**: Chrome Manifest V3, Vite + TypeScript, Shadow DOM
- **Servidor**: Node.js con WebSocket (`ws`)
- **Comunicación**: Protocolo WebSocket con heartbeat, reconexión exponencial

## Requisitos

- Node.js 18+
- Google Chrome
- WhatsApp Web (https://web.whatsapp.com)

## Instalación

```bash
# Clonar el repositorio
git clone https://github.com/MartinZahid/Whatsapp-teamSync.git
cd Whatsapp-teamSync

# Instalar dependencias
npm install

# Compilar servidor
npm run build:server

# Compilar extensión
npm run build
```

### Cargar la extensión en Chrome

1. Abrir `chrome://extensions`
2. Activar "Modo de desarrollador"
3. Click en "Cargar descomprimida"
4. Seleccionar la carpeta `dist/` del proyecto

## Uso

### Iniciar el servidor

```bash
npm run server
# o directamente:
node server/dist/server.js
```

### Conectar un agente

1. Abrir WhatsApp Web (`https://web.whatsapp.com`)
2. Click en el icono de la extensión (WhatsApp Team Sync)
3. Seleccionar tu nombre de la lista o escribir uno personalizado
4. El panel se mostrará en la esquina superior derecha de WhatsApp Web

## Estructura del proyecto

```
whatsapp-team-sync/
├── extension/             # Código de la extensión Chrome
│   └── src/
│       ├── background/    # Service worker (WebSocket client)
│       ├── content/       # Content script (DOM observer, panel UI)
│       ├── popup/         # Popup de la extensión (configuración)
│       └── options/       # Página de opciones
├── server/                # Servidor WebSocket
│   └── src/
│       ├── server.ts      # Entry point
│       ├── rooms.ts       # Registro de agentes y presencia
│       └── types.ts       # Tipos compartidos
├── shared/                # Tipos compartidos (copia)
├── dist/                  # Build output
└── vite.config.ts
```

## Protocolo WebSocket

### Cliente → Servidor

| Tipo | Descripción |
|------|-------------|
| `ATTENDING` | Agente está atendiendo un chat |
| `AVAILABLE` | Agente está disponible |
| `PAUSED` | Agente pausó su atención |
| `OFFLINE` | Agente se desconectó |
| `DELETE_AGENT` | Eliminar agente del servidor |
| `HEARTBEAT` | Heartbeat (cada 30s) |

### Servidor → Cliente

| Tipo | Descripción |
|------|-------------|
| `PRESENCE_UPDATE` | Lista actualizada de agentes |
| `SERVER_INFO` | Estado inicial al conectar |
| `ERROR` | Error del servidor |

## Licencia

MIT
