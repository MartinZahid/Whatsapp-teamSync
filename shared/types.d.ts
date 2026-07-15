export type AgentStatus = 'active' | 'paused' | 'available' | 'offline';
export interface Agent {
    id: string;
    name: string;
    status: AgentStatus;
    contact: string | null;
    color: string;
    lastSeen: number;
}
export interface PresenceUpdate {
    type: 'PRESENCE_UPDATE';
    agents: Agent[];
}
export interface AttendingMessage {
    type: 'ATTENDING';
    agent: string;
    contact: string;
    status: 'active';
}
export interface PausedMessage {
    type: 'PAUSED';
    agent: string;
    reason?: string;
}
export interface AvailableMessage {
    type: 'AVAILABLE';
    agent: string;
}
export interface OfflineMessage {
    type: 'OFFLINE';
    agent: string;
}
export interface DeleteAgentMessage {
    type: 'DELETE_AGENT';
    agent: string;
}
export interface HeartbeatMessage {
    type: 'HEARTBEAT';
    agent: string;
}
export type ClientToServerMessage = AttendingMessage | PausedMessage | AvailableMessage | OfflineMessage | DeleteAgentMessage | HeartbeatMessage;
export interface ServerInfoMessage {
    type: 'SERVER_INFO';
    version: string;
    agents: Agent[];
}
export interface ErrorMessage {
    type: 'ERROR';
    code: string;
    message: string;
}
export interface WelcomeMessage {
    type: 'WELCOME';
    message: string;
    protocol: string;
}
export type ServerToClientMessage = PresenceUpdate | ServerInfoMessage | ErrorMessage | WelcomeMessage;
export type WSMessage = ClientToServerMessage | ServerToClientMessage;
export declare function isAttendingMessage(msg: WSMessage): msg is AttendingMessage;
export declare function isPausedMessage(msg: WSMessage): msg is PausedMessage;
export declare function isAvailableMessage(msg: WSMessage): msg is AvailableMessage;
export declare function isOfflineMessage(msg: WSMessage): msg is OfflineMessage;
export declare function isDeleteAgentMessage(msg: WSMessage): msg is DeleteAgentMessage;
export declare function isHeartbeatMessage(msg: WSMessage): msg is HeartbeatMessage;
export declare function isPresenceUpdate(msg: WSMessage): msg is PresenceUpdate;
export declare function isServerInfo(msg: WSMessage): msg is ServerInfoMessage;
export declare function isErrorMessage(msg: WSMessage): msg is ErrorMessage;
export declare const STATUS_COLORS: Record<AgentStatus, string>;
export declare const STATUS_LABELS: Record<AgentStatus, string>;
export declare function getStatusColor(status: AgentStatus): string;
export declare function getStatusLabel(status: AgentStatus): string;
export declare function getStatusClass(status: AgentStatus): string;
