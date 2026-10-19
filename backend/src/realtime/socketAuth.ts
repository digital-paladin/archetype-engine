import { Socket } from 'socket.io';
import { resolveCredential } from '../middleware/auth.middleware';

/**
 * Join `user:<id>` when the handshake carries a valid login token, personal
 * API key, or System service credential. Connections without a token stay
 * anonymous and never join a user room, so System events are not broadcast.
 */
export async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  const raw = socket.handshake.auth?.token;
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) {
    next();
    return;
  }
  try {
    const auth = await resolveCredential(token);
    if (auth?.userId) {
      socket.data.userId = auth.userId;
      await socket.join(`user:${auth.userId}`);
    }
  } catch (err) {
    console.warn('[SOCKET] credential rejected:', err instanceof Error ? err.message : err);
  }
  next();
}
