// Shared types between extension and server — SINGLE SOURCE OF TRUTH

export type AgentStatus = 'active' | 'paused' | 'available' | 'offline'

export interface Agent {
  id: string
  name: string
  status: AgentStatus
  contact: string | null
  color: string
  lastSeen: number
  chatStartTime?: number
  helpRequested?: boolean
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

export interface HeartbeatMessage {
  type: 'HEARTBEAT'
  agent: string
}

export interface HelpRequestMessage {
  type: 'HELP_REQUEST'
  agent: string
  requesting: boolean
}

export type ClientToServerMessage = AttendingMessage | PausedMessage | AvailableMessage | OfflineMessage | DeleteAgentMessage | HeartbeatMessage | HelpRequestMessage

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

export interface WelcomeMessage {
  type: 'WELCOME'
  message: string
  protocol: string
}

export type ServerToClientMessage = PresenceUpdate | ServerInfoMessage | ErrorMessage | WelcomeMessage

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

export function isHeartbeatMessage(msg: WSMessage): msg is HeartbeatMessage {
  return msg.type === 'HEARTBEAT'
}

export function isHelpRequestMessage(msg: WSMessage): msg is HelpRequestMessage {
  return msg.type === 'HELP_REQUEST'
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

export function getStatusColor(status: AgentStatus): string {
  return STATUS_COLORS[status]
}

export function getStatusLabel(status: AgentStatus): string {
  return STATUS_LABELS[status]
}

export function getStatusClass(status: AgentStatus): string {
  return status
}