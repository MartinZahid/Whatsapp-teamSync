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
export type ClientToServerMessage = AttendingMessage | PausedMessage | AvailableMessage | OfflineMessage;
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
export type ServerToClientMessage = PresenceUpdate | ServerInfoMessage | ErrorMessage;
export type WSMessage = ClientToServerMessage | ServerToClientMessage;
export declare function isAttendingMessage(msg: WSMessage): msg is AttendingMessage;
export declare function isPausedMessage(msg: WSMessage): msg is PausedMessage;
export declare function isAvailableMessage(msg: WSMessage): msg is AvailableMessage;
export declare function isOfflineMessage(msg: WSMessage): msg is OfflineMessage;
export declare function isPresenceUpdate(msg: WSMessage): msg is PresenceUpdate;
export declare function isServerInfo(msg: WSMessage): msg is ServerInfoMessage;
export declare function isErrorMessage(msg: WSMessage): msg is ErrorMessage;
export declare const STATUS_COLORS: Record<AgentStatus, string>;
export declare const STATUS_LABELS: Record<AgentStatus, string>;
