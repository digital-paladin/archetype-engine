import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';

interface AuthActionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

interface AuthCallbackResult {
  success: boolean;
  type?: 'recovery' | 'magiclink' | 'signup' | 'invite' | string;
  error?: string;
}

interface LoginResponse extends AuthActionResponse {
  token?: string;
  refreshToken?: string;
  needsLogin?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly TOKEN_KEY = 'auth_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Login with username and password
   * Stores token in localStorage on success
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    try {
      const response = await firstValueFrom(
        this.http.post<LoginResponse>(`${this.apiUrl}/api/auth/login`, {
          username,
          password,
        })
      );

      if (response.success && response.token) {
        this.setToken(response.token);
        if (response.refreshToken) this.setRefreshToken(response.refreshToken);
      }

      return response;
    } catch (error: any) {
      let errorMessage = 'Login failed';

      if (error.status === 0) {
        errorMessage = 'Cannot connect to backend. Check that the API is running and CORS is configured.';
      } else if (error.status === 401) {
        errorMessage = 'Invalid email or password.';
      } else if (error.status === 500) {
        errorMessage = 'Backend server error. Check deployment logs.';
      } else if (error.status === 404) {
        errorMessage = 'Login endpoint not found. Check backend routes.';
      } else {
        errorMessage = error.error?.error || error.message || 'Unknown error';
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Public Try Demo — no credentials. Backend issues a session for DEMO_USER_ID.
   */
  async demoLogin(): Promise<LoginResponse> {
    try {
      const response = await firstValueFrom(
        this.http.post<LoginResponse>(`${this.apiUrl}/api/auth/demo-login`, {})
      );

      if (response.success && response.token) {
        this.setToken(response.token);
        if (response.refreshToken) this.setRefreshToken(response.refreshToken);
      }

      return response;
    } catch (error: any) {
      const status = error.status as number | undefined;
      let errorMessage = error.error?.error || error.message || 'Demo login failed';
      if (status === 503) {
        errorMessage = error.error?.error || 'Demo is not available yet.';
      } else if (status === 429) {
        errorMessage = 'Too many demo logins — try again later.';
      } else if (status === 0) {
        errorMessage = 'Cannot connect to backend. Check that the API is running.';
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Thin onboarding signup — email + password + birthDate + optional identity scaffold.
   */
  async signup(
    email: string,
    password: string,
    birthDate: string,
    opts?: { domains?: string[]; classDisplayName?: string }
  ): Promise<LoginResponse> {
    try {
      const response = await firstValueFrom(
        this.http.post<LoginResponse>(`${this.apiUrl}/api/auth/signup`, {
          email,
          password,
          birthDate,
          ...(opts?.domains?.length ? { domains: opts.domains } : {}),
          ...(opts?.classDisplayName ? { classDisplayName: opts.classDisplayName } : {}),
        })
      );

      if (response.success && response.token) {
        this.setToken(response.token);
        if (response.refreshToken) this.setRefreshToken(response.refreshToken);
      }

      return response;
    } catch (error: any) {
      return {
        success: false,
        error: error.error?.error || error.message || 'Signup failed',
      };
    }
  }

  /** Public domain + template catalog for signup step 2. */
  async getOnboardingOptions(): Promise<{
    success: boolean;
    domains?: string[];
    templates?: Array<{ id: string; name: string; tagline: string }>;
    error?: string;
  }> {
    try {
      return await firstValueFrom(
        this.http.get<{
          success: boolean;
          domains: string[];
          templates: Array<{ id: string; name: string; tagline: string }>;
        }>(`${this.apiUrl}/api/auth/onboarding-options`)
      );
    } catch (error: any) {
      return { success: false, error: error.error?.error || error.message || 'Failed to load options' };
    }
  }

  async suggestClass(domains: string[]): Promise<{
    success: boolean;
    template?: { id: string; name: string; tagline: string };
    error?: string;
  }> {
    try {
      return await firstValueFrom(
        this.http.post<{ success: boolean; template: { id: string; name: string; tagline: string } }>(
          `${this.apiUrl}/api/auth/suggest-class`,
          { domains }
        )
      );
    } catch (error: any) {
      return { success: false, error: error.error?.error || error.message || 'Suggest failed' };
    }
  }

  /**
   * Silently refresh the access token using the stored refresh token.
   * Returns the new access token on success, null otherwise.
   */
  async refresh(): Promise<string | null> {
    const storedRefresh = this.getRefreshToken();
    if (!storedRefresh) return null;

    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; token: string; refreshToken: string }>(
          `${this.apiUrl}/api/auth/refresh`,
          { refreshToken: storedRefresh }
        )
      );
      if (response.success && response.token) {
        this.setToken(response.token);
        if (response.refreshToken) this.setRefreshToken(response.refreshToken);
        return response.token;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Request a password-reset email (Supabase recovery flow).
   */
  async requestPasswordReset(email: string): Promise<AuthActionResponse> {
    try {
      return await firstValueFrom(
        this.http.post<AuthActionResponse>(`${this.apiUrl}/api/auth/forgot-password`, { email })
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.error?.error || error.message || 'Could not send reset email',
      };
    }
  }

  /**
   * Request a magic-link sign-in email (Supabase OTP).
   */
  async requestMagicLink(email: string): Promise<AuthActionResponse> {
    try {
      return await firstValueFrom(
        this.http.post<AuthActionResponse>(`${this.apiUrl}/api/auth/magic-link`, { email })
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.error?.error || error.message || 'Could not send magic link',
      };
    }
  }

  /**
   * Set a new password after recovery callback (requires stored session token).
   */
  async updatePassword(password: string): Promise<AuthActionResponse> {
    const token = this.getToken();
    if (!token) {
      return { success: false, error: 'Session expired. Request a new reset link.' };
    }

    try {
      return await firstValueFrom(
        this.http.post<AuthActionResponse>(
          `${this.apiUrl}/api/auth/update-password`,
          { password },
          { headers: { Authorization: `Bearer ${token}` } }
        )
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.error?.error || error.message || 'Could not update password',
      };
    }
  }

  /**
   * Parse Supabase redirect tokens from the URL hash/query after email link click.
   */
  consumeAuthCallbackFromUrl(): AuthCallbackResult {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const queryParams = new URLSearchParams(window.location.search);

    const error =
      hashParams.get('error_description') ||
      hashParams.get('error') ||
      queryParams.get('error_description') ||
      queryParams.get('error');

    if (error) {
      return { success: false, error };
    }

    const accessToken = hashParams.get('access_token') || queryParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');
    const type = hashParams.get('type') || queryParams.get('type') || 'magiclink';

    if (!accessToken) {
      return { success: false, error: 'Missing sign-in token. The link may have expired.' };
    }

    this.setToken(accessToken);
    if (refreshToken) this.setRefreshToken(refreshToken);

    // Remove tokens from browser history
    window.history.replaceState({}, document.title, window.location.pathname);

    return { success: true, type };
  }

  /**
   * Verify if current token is valid
   */
  async verifyToken(): Promise<boolean> {
    const token = this.getToken();
    if (!token) return false;

    try {
      const response = await firstValueFrom(
        this.http.get<{ success: boolean }>(`${this.apiUrl}/api/auth/verify`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      return response.success;
    } catch (error) {
      console.error('Token verification failed:', error);
      this.clearToken();
      return false;
    }
  }

  /**
   * Logout - clear token from storage
   */
  logout(): void {
    this.clearToken();
  }

  /**
   * Check if user is authenticated (has token)
   */
  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  /**
   * Get auth token from localStorage
   */
  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  /**
   * Get refresh token from localStorage
   */
  getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  /**
   * Store token in localStorage
   */
  private setToken(token: string): void {
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  /**
   * Store refresh token in localStorage
   */
  private setRefreshToken(token: string): void {
    localStorage.setItem(this.REFRESH_TOKEN_KEY, token);
  }

  /**
   * Remove all auth tokens from localStorage
   */
  private clearToken(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
  }
}
