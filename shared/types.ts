// Shared types between extension and server

export type AgentStatus = 'active' | 'paused' | 'available' | 'offline'

export interface Agent {
  id: string
  name: string
  status: AgentStatus
  contact: string | null
  color: string
  lastSeen: number
}

export interface PresenceUpdate {
  type: 'PRESENCE_UPDATE'
  agents: Agent[]
}

export interface AttendingMessage {
  type: 'ATTENDING'
  agent: string
  contact: string
  status: 'active'
}

export interface PausedMessage {
  type: 'PAUSED'
  agent: string
  reason?: string
}

export interface AvailableMessage {
  type: 'AVAILABLE'
  agent: string
}

export interface OfflineMessage {
  type: 'OFFLINE'
  agent: string
}

export interface DeleteAgentMessage {
  type: 'DELETE_AGENT'
  agent: string
}

export type ClientToServerMessage = AttendingMessage | PausedMessage | AvailableMessage | OfflineMessage | DeleteAgentMessage

export interface ServerInfoMessage {
  type: 'SERVER_INFO'
  version: string
  agents: Agent[]
}

export interface ErrorMessage {
  type: 'ERROR'
  code: string
  message: string
}

export type ServerToClientMessage = PresenceUpdate | ServerInfoMessage | ErrorMessage

export type WSMessage = ClientToServerMessage | ServerToClientMessage

// Message type guards
export function isAttendingMessage(msg: WSMessage): msg is AttendingMessage {
  return msg.type === 'ATTENDING'
}

export function isPausedMessage(msg: WSMessage): msg is PausedMessage {
  return msg.type === 'PAUSED'
}

export function isAvailableMessage(msg: WSMessage): msg is AvailableMessage {
  return msg.type === 'AVAILABLE'
}

export function isOfflineMessage(msg: WSMessage): msg is OfflineMessage {
  return msg.type === 'OFFLINE'
}

export function isDeleteAgentMessage(msg: WSMessage): msg is DeleteAgentMessage {
  return msg.type === 'DELETE_AGENT'
}

export function isPresenceUpdate(msg: WSMessage): msg is PresenceUpdate {
  return msg.type === 'PRESENCE_UPDATE'
}

export function isServerInfo(msg: WSMessage): msg is ServerInfoMessage {
  return msg.type === 'SERVER_INFO'
}

export function isErrorMessage(msg: WSMessage): msg is ErrorMessage {
  return msg.type === 'ERROR'
}

// Status colors
export const STATUS_COLORS: Record<AgentStatus, string> = {
  active: '#ef4444',      // red
  paused: '#f59e0b',      // yellow/amber
  available: '#22c55e',   // green
  offline: '#9ca3af'      // gray
}

export const STATUS_LABELS: Record<AgentStatus, string> = {
  active: 'Atendiendo',
  paused: 'Pausado',
  available: 'Disponible',
  offline: 'Desconectado'
}