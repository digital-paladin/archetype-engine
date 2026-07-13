import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

type LoginMode = 'login' | 'signup' | 'forgot' | 'magic';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <div class="login-header">
          <h1>🛡️ Digital Paladin</h1>
          <p>Character Progression Tracker</p>
        </div>

        @if (mode() === 'login') {
          <form (ngSubmit)="onLogin()" class="login-form">
            <div class="form-group">
              <label for="username">Email</label>
              <input
                id="username"
                type="email"
                [(ngModel)]="username"
                name="username"
                placeholder="you@example.com"
                required
                [disabled]="isBusy()"
              />
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input
                id="password"
                type="password"
                [(ngModel)]="password"
                name="password"
                placeholder="Enter password"
                required
                [disabled]="isBusy()"
              />
            </div>

            @if (errorMessage()) {
              <div class="error-message">
                <pre>{{ errorMessage() }}</pre>
              </div>
            }

            @if (successMessage()) {
              <div class="success-message">{{ successMessage() }}</div>
            }

            <button
              type="submit"
              class="login-button"
              [disabled]="!username || !password || isBusy()"
            >
              {{ isBusy() ? 'Logging in…' : 'Login' }}
            </button>

            <div class="auth-links">
              <button type="button" class="text-link" (click)="setMode('signup')">
                Create account
              </button>
              <span class="divider">·</span>
              <button type="button" class="text-link" (click)="setMode('forgot')">
                Forgot password?
              </button>
              <span class="divider">·</span>
              <button type="button" class="text-link" (click)="setMode('magic')">
                Sign in with magic link
              </button>
            </div>
          </form>
        }

        @if (mode() === 'signup') {
          <form (ngSubmit)="onSignup()" class="login-form">
            <p class="mode-copy">
              The System has detected a new Hunter. Set your birth date —
              Overall Level is your chronological age.
            </p>

            <div class="form-group">
              <label for="signup-email">Email</label>
              <input
                id="signup-email"
                type="email"
                [(ngModel)]="username"
                name="signupEmail"
                placeholder="you@example.com"
                required
                [disabled]="isBusy()"
              />
            </div>

            <div class="form-group">
              <label for="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                [(ngModel)]="password"
                name="signupPassword"
                placeholder="At least 8 characters"
                required
                minlength="8"
                [disabled]="isBusy()"
              />
            </div>

            <div class="form-group">
              <label for="signup-password2">Confirm password</label>
              <input
                id="signup-password2"
                type="password"
                [(ngModel)]="passwordConfirm"
                name="signupPassword2"
                placeholder="Repeat password"
                required
                [disabled]="isBusy()"
              />
            </div>

            <div class="form-group">
              <label for="birth-date">Birth date</label>
              <input
                id="birth-date"
                type="date"
                [(ngModel)]="birthDate"
                name="birthDate"
                required
                [disabled]="isBusy()"
              />
            </div>

            @if (errorMessage()) {
              <div class="error-message">
                <pre>{{ errorMessage() }}</pre>
              </div>
            }

            @if (successMessage()) {
              <div class="success-message">{{ successMessage() }}</div>
            }

            <button
              type="submit"
              class="login-button"
              [disabled]="!canSignup() || isBusy()"
            >
              {{ isBusy() ? 'Creating…' : 'Begin journey' }}
            </button>

            <button type="button" class="text-link back-link" (click)="setMode('login')">
              ← Back to login
            </button>
          </form>
        }

        @if (mode() === 'forgot') {
          <form (ngSubmit)="onForgotPassword()" class="login-form">
            <p class="mode-copy">Enter your email and we'll send a reset link.</p>

            <div class="form-group">
              <label for="reset-email">Email</label>
              <input
                id="reset-email"
                type="email"
                [(ngModel)]="username"
                name="resetEmail"
                placeholder="you@example.com"
                required
                [disabled]="isBusy()"
              />
            </div>

            @if (errorMessage()) {
              <div class="error-message">{{ errorMessage() }}</div>
            }
            @if (successMessage()) {
              <div class="success-message">{{ successMessage() }}</div>
            }

            <button type="submit" class="login-button" [disabled]="!username || isBusy()">
              {{ isBusy() ? 'Sending…' : 'Send reset link' }}
            </button>

            <button type="button" class="text-link back-link" (click)="setMode('login')">
              ← Back to login
            </button>
          </form>
        }

        @if (mode() === 'magic') {
          <form (ngSubmit)="onMagicLink()" class="login-form">
            <p class="mode-copy">We'll email you a one-time sign-in link. No password needed.</p>

            <div class="form-group">
              <label for="magic-email">Email</label>
              <input
                id="magic-email"
                type="email"
                [(ngModel)]="username"
                name="magicEmail"
                placeholder="you@example.com"
                required
                [disabled]="isBusy()"
              />
            </div>

            @if (errorMessage()) {
              <div class="error-message">{{ errorMessage() }}</div>
            }
            @if (successMessage()) {
              <div class="success-message">{{ successMessage() }}</div>
            }

            <button type="submit" class="login-button" [disabled]="!username || isBusy()">
              {{ isBusy() ? 'Sending…' : 'Send magic link' }}
            </button>

            <button type="button" class="text-link back-link" (click)="setMode('login')">
              ← Back to login
            </button>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #0d0a06;
      background-image:
        radial-gradient(ellipse 85% 55% at 50% 15%, rgba(45,30,10,0.55) 0%, transparent 65%),
        radial-gradient(ellipse 60% 35% at 50% 100%, rgba(12,6,2,0.70) 0%, transparent 50%);
      padding: 20px;
    }

    .login-card {
      background: #120e07;
      border: 1px solid rgba(155,115,38,0.60);
      padding: 40px;
      max-width: 420px;
      width: 100%;
      position: relative;
      box-shadow:
        inset 0 1px 0 rgba(255,220,150,0.04),
        0 4px 40px rgba(0,0,0,0.75);
    }

    .login-header { text-align: center; margin-bottom: 32px; }

    .login-header h1 {
      font-family: 'Cinzel', 'Palatino Linotype', serif;
      font-size: 26px;
      font-weight: 700;
      margin: 0 0 8px 0;
      color: #f2c96a;
      letter-spacing: 3px;
    }

    .login-header p {
      color: #a08858;
      margin: 0;
      font-size: 10px;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      font-family: 'Cinzel', serif;
    }

    .login-form { display: flex; flex-direction: column; gap: 18px; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .mode-copy { color: #a08858; font-size: 13px; margin: 0; line-height: 1.5; }

    .form-group label {
      font-family: 'Cinzel', serif;
      font-size: 10px;
      font-weight: 600;
      color: #a08858;
      letter-spacing: 1.8px;
      text-transform: uppercase;
    }

    .form-group input {
      background: #090705;
      border: 1px solid rgba(110,82,28,0.40);
      color: #e2cfa8;
      font-size: 14px;
      padding: 10px 12px;
      border-radius: 0;
    }
    .form-group input:focus {
      outline: none;
      border-color: rgba(155,115,38,0.90);
    }
    .form-group input:disabled { opacity: 0.45; }

    .error-message {
      background: rgba(110,20,20,0.28);
      border: 1px solid rgba(180,30,30,0.45);
      padding: 10px 12px;
      color: #ff8888;
      font-size: 13px;
    }
    .error-message pre {
      margin: 0;
      white-space: pre-wrap;
      font-family: inherit;
    }

    .success-message {
      background: rgba(20,60,30,0.28);
      border: 1px solid rgba(40,120,60,0.45);
      padding: 10px 12px;
      color: #88dd99;
      font-size: 13px;
    }

    .login-button {
      background: linear-gradient(180deg, rgba(58,42,12,0.92) 0%, rgba(22,16,5,0.96) 100%);
      border: 1px solid rgba(155,115,38,0.65);
      color: #c9a84c;
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      padding: 12px;
      cursor: pointer;
    }
    .login-button:hover:not(:disabled) {
      border-color: #c9a84c;
      color: #f2c96a;
    }
    .login-button:disabled { opacity: 0.38; cursor: not-allowed; }

    .auth-links {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .divider { color: #6a5030; }
    .text-link {
      background: none;
      border: none;
      color: #a08858;
      font-size: 12px;
      cursor: pointer;
      padding: 0;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .text-link:hover { color: #c9a84c; }
    .back-link { align-self: center; text-decoration: none; }
  `]
})
export class LoginComponent {
  username = '';
  password = '';
  passwordConfirm = '';
  birthDate = '';
  mode = signal<LoginMode>('login');
  isBusy = signal(false);
  errorMessage = signal('');
  successMessage = signal('');

  constructor(
    private authService: AuthService,
    private router: Router,
  ) {}

  setMode(mode: LoginMode): void {
    this.mode.set(mode);
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  canSignup(): boolean {
    return (
      !!this.username &&
      this.password.length >= 8 &&
      this.password === this.passwordConfirm &&
      !!this.birthDate
    );
  }

  async onLogin(): Promise<void> {
    this.isBusy.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      const result = await this.authService.login(this.username, this.password);
      if (result.success) {
        this.router.navigate(['/dashboard']);
      } else {
        this.errorMessage.set(result.error || 'Login failed');
      }
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Network error. Please try again.');
    } finally {
      this.isBusy.set(false);
    }
  }

  async onSignup(): Promise<void> {
    this.isBusy.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    if (this.password !== this.passwordConfirm) {
      this.errorMessage.set('Passwords do not match.');
      this.isBusy.set(false);
      return;
    }

    try {
      const result = await this.authService.signup(
        this.username,
        this.password,
        this.birthDate
      );
      if (result.success && result.token) {
        this.router.navigate(['/dashboard']);
      } else if (result.success && result.needsLogin) {
        this.successMessage.set(result.message || 'Account created — please log in.');
        this.setMode('login');
      } else {
        this.errorMessage.set(result.error || 'Signup failed');
      }
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Network error. Please try again.');
    } finally {
      this.isBusy.set(false);
    }
  }

  async onForgotPassword(): Promise<void> {
    this.isBusy.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const result = await this.authService.requestPasswordReset(this.username);
    this.isBusy.set(false);

    if (result.success) {
      this.successMessage.set(result.message || 'Check your email for a reset link.');
      return;
    }
    this.errorMessage.set(result.error || 'Could not send reset email.');
  }

  async onMagicLink(): Promise<void> {
    this.isBusy.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    const result = await this.authService.requestMagicLink(this.username);
    this.isBusy.set(false);

    if (result.success) {
      this.successMessage.set(result.message || 'Check your email for your sign-in link.');
      return;
    }
    this.errorMessage.set(result.error || 'Could not send magic link.');
  }
}
