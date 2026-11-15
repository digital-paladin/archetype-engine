import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../environments/environment';
import {
  WEARABLE_PROVIDERS,
  WearableProvider,
  wearableProvider,
} from './wearable-providers';

export interface WearableProviderRaw {
  configured?: boolean;
  connected?: boolean;
  connectPath?: string;
}

export interface WearableStatusResponse {
  success?: boolean;
  providers?: Record<string, WearableProviderRaw>;
}

export interface WearableProviderStatus {
  id: string;
  configured: boolean | null;
  connected: boolean | null;
  connectPath: string;
}

interface ConnectUrlResponse {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Starts the OAuth flow declared on a wearable provider and reads
 * GET /api/wearables/status. Sleep panel links and the Integrations tab
 * both go through here.
 */
@Injectable({ providedIn: 'root' })
export class WearableConnectService {
  private readonly http = inject(HttpClient);
  private readonly statusUrl = `${environment.apiUrl}/api/wearables/status`;

  readonly providers = WEARABLE_PROVIDERS;

  status(): Observable<WearableProviderStatus[]> {
    return this.http.get<WearableStatusResponse>(this.statusUrl).pipe(
      map((body) => this.providers.map((provider) => this.readProvider(provider, body.providers?.[provider.id]))),
    );
  }

  /**
   * `connectPath` overrides the registry path when status returned one.
   * Completes after navigation starts. Errors when a connect-url flow cannot start.
   */
  connect(id: string, connectPath?: string): Observable<void> {
    const provider = wearableProvider(id);
    const path = connectPath || provider.connectPath;
    if (provider.connectMode === 'redirect') {
      this.openAuthorizeUrl(this.absolute(path));
      return EMPTY;
    }
    return this.http.get<ConnectUrlResponse>(this.absolute(path)).pipe(
      switchMap((res) => {
        if (res.success && res.url) {
          this.openAuthorizeUrl(res.url);
          return EMPTY;
        }
        return throwError(() => new Error(res.error || provider.notConfiguredMessage));
      }),
      catchError((err: unknown) => throwError(() => new Error(connectFailureMessage(err, provider)))),
    );
  }

  absolute(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${environment.apiUrl}${suffix}`;
  }

  openAuthorizeUrl(url: string): void {
    window.location.href = url;
  }

  private readProvider(provider: WearableProvider, raw: WearableProviderRaw | undefined): WearableProviderStatus {
    return {
      id: provider.id,
      configured: typeof raw?.configured === 'boolean' ? raw.configured : null,
      connected: typeof raw?.connected === 'boolean' ? raw.connected : null,
      connectPath: raw?.connectPath || provider.connectPath,
    };
  }
}

function connectFailureMessage(err: unknown, provider: WearableProvider): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: string } | null;
    return (body && body.error) || provider.connectFailedMessage;
  }
  if (err instanceof Error && err.message) return err.message;
  return provider.connectFailedMessage;
}
