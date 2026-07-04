// socket.service.ts
// Angular service for Socket.IO real-time updates

import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket;
  private readonly url = environment.apiUrl;

  constructor() {
    this.socket = io(this.url, {
      transports: ['websocket'],  // Railway supports WebSocket only; polling returns 502
      autoConnect: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    });
    this.socket.on('connect', () => console.log('[Socket] ✅ Connected:', this.socket.id));
    this.socket.on('disconnect', (reason) => console.log('[Socket] ❌ Disconnected:', reason));
    this.socket.on('connect_error', (err) => console.error('[Socket] 💥 Connect error:', err.message));
  }

  onCharacterUpdate(): Observable<any> {
    return new Observable((observer) => {
      this.socket.on('character:updated', (data: any) => {
        observer.next(data);
      });
    });
  }

  onXpProjectionUpdate(): Observable<any> {
    return new Observable((observer) => {
      this.socket.on('xp-projection-update', (data: any) => {
        observer.next(data);
      });
    });
  }

  onActivityLogged(): Observable<any> {
    return new Observable((observer) => {
      this.socket.on('activity-logged', (data: any) => {
        observer.next(data);
      });
    });
  }

  onJournalUpdate(): Observable<{ timestamp: string }> {
    return new Observable((observer) => {
      this.socket.on('journal:updated', (data: any) => {
        observer.next(data);
      });
    });
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
