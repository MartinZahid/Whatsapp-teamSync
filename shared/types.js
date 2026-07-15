// Shared types between extension and server — SINGLE SOURCE OF TRUTH
// Message type guards
export function isAttendingMessage(msg) {
    return msg.type === 'ATTENDING';
}
export function isPausedMessage(msg) {
    return msg.type === 'PAUSED';
}
export function isAvailableMessage(msg) {
    return msg.type === 'AVAILABLE';
}
export function isOfflineMessage(msg) {
    return msg.type === 'OFFLINE';
}
export function isDeleteAgentMessage(msg) {
    return msg.type === 'DELETE_AGENT';
}
export function isHeartbeatMessage(msg) {
    return msg.type === 'HEARTBEAT';
}
export function isPresenceUpdate(msg) {
    return msg.type === 'PRESENCE_UPDATE';
}
export function isServerInfo(msg) {
    return msg.type === 'SERVER_INFO';
}
export function isErrorMessage(msg) {
    return msg.type === 'ERROR';
}
// Status colors
export const STATUS_COLORS = {
    active: '#ef4444',
    paused: '#f59e0b',
    available: '#22c55e',
    offline: '#9ca3af'
};
export const STATUS_LABELS = {
    active: 'Atendiendo',
    paused: 'Pausado',
    available: 'Disponible',
    offline: 'Desconectado'
};
export function getStatusColor(status) {
    return STATUS_COLORS[status];
}
export function getStatusLabel(status) {
    return STATUS_LABELS[status];
}
export function getStatusClass(status) {
    return status;
}
