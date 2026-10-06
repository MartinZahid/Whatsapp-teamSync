// Shared types between extension and server — SINGLE SOURCE OF TRUTH

export type AgentStatus = 'active' | 'paused' | 'available' | 'offline'

export interface AgentConfig {
  agentName: string
  serverUrl: string
}

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

export interface TypingMessage {
  type: 'TYPING'
  agent: string
  contact: string
  typing: boolean
}

export interface ClaimChatMessage {
  type: 'CLAIM_CHAT'
  agent: string
  contact: string
}

export type ClientToServerMessage = AttendingMessage | PausedMessage | AvailableMessage | OfflineMessage | DeleteAgentMessage | HeartbeatMessage | HelpRequestMessage | TypingMessage | ClaimChatMessage

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

export interface DuplicateAlertMessage {
  type: 'DUPLICATE_ALERT'
  contact: string
  ownerName: string
  isOwner: boolean
  others: string[]
}

export interface DuplicateClearMessage {
  type: 'DUPLICATE_CLEAR'
  contact: string
}

export type ServerToClientMessage = PresenceUpdate | ServerInfoMessage | ErrorMessage | WelcomeMessage | DuplicateAlertMessage | DuplicateClearMessage

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

export function isTypingMessage(msg: WSMessage): msg is TypingMessage {
  return msg.type === 'TYPING'
}

export function isClaimChatMessage(msg: WSMessage): msg is ClaimChatMessage {
  return msg.type === 'CLAIM_CHAT'
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