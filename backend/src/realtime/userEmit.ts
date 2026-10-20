import { Server as SocketIOServer } from 'socket.io';

/**
 * Deliver an event only to sockets that authenticated as this user.
 * Unauthenticated sockets are not in the room, so nothing is broadcast.
 */
export function emitToUser(
  io: SocketIOServer | undefined | null,
  userId: string | undefined,
  event: string,
  payload: unknown,
): void {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
}
