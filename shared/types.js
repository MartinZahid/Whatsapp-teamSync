// Shared types between extension and server
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
    active: '#ef4444', // red
    paused: '#f59e0b', // yellow/amber
    available: '#22c55e', // green
    offline: '#9ca3af' // gray
};
export const STATUS_LABELS = {
    active: 'Atendiendo',
    paused: 'Pausado',
    available: 'Disponible',
    offline: 'Desconectado'
};
