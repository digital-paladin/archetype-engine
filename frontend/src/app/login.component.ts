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

            <button
              type="button"
              id="try-demo"
              class="demo-button"
              [disabled]="isBusy()"
              (click)="onDemoLogin()"
            >
              {{ isBusy() ? 'Opening demo…' : 'Try demo' }}
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
          <form (ngSubmit)="onSignupNext()" class="login-form">
            @if (signupStep() === 1) {
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
            } @else {
              <p class="mode-copy" id="domain-step-copy">
                Who do you want to become? Pick 3–5 life domains —
                The System will suggest your class archetype.
              </p>

              <div class="domain-grid" id="domain-grid">
                @for (d of domainOptions(); track d) {
                  <label class="domain-chip" [class.selected]="selectedDomains.includes(d)">
                    <input
                      type="checkbox"
                      [checked]="selectedDomains.includes(d)"
                      (change)="toggleDomain(d, $event)"
                      [disabled]="isBusy()"
                    />
                    <span>{{ d }}</span>
                  </label>
                }
              </div>

              @if (suggestedClass()) {
                <p class="suggest-line" id="suggested-class">
                  Suggested class: <strong>{{ suggestedClass()!.name }}</strong>
                  — {{ suggestedClass()!.tagline }}
                </p>
              }

              <div class="form-group">
                <label for="class-display-name">Class display name</label>
                <input
                  id="class-display-name"
                  type="text"
                  [(ngModel)]="classDisplayName"
                  name="classDisplayName"
                  maxlength="48"
                  placeholder="e.g. Iron Monk"
                  [disabled]="isBusy()"
                />
              </div>
            }

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
              [disabled]="!canSignupStep() || isBusy()"
            >
              @if (isBusy()) {
                {{ signupStep() === 1 ? '…' : 'Creating…' }}
              } @else if (signupStep() === 1) {
                Continue
              } @else {
                Begin journey
              }
            </button>

            @if (signupStep() === 2) {
              <button type="button" class="text-link back-link" (click)="signupStep.set(1)">
                ← Back
              </button>
            } @else {
              <button type="button" class="text-link back-link" (click)="setMode('login')">
                ← Back to login
              </button>
            }
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

    .demo-button {
      width: 100%;
      margin-top: 10px;
      background: transparent;
      border: 1px solid rgba(155,115,38,0.45);
      color: #a08858;
      font-family: 'Cinzel', serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      padding: 11px;
      cursor: pointer;
    }
    .demo-button:hover:not(:disabled) {
      border-color: #c9a84c;
      color: #f2c96a;
    }
    .demo-button:disabled { opacity: 0.38; cursor: not-allowed; }

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

    .domain-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-height: 220px;
      overflow-y: auto;
    }
    .domain-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid rgba(110,82,28,0.45);
      padding: 6px 10px;
      color: #a08858;
      font-size: 12px;
      cursor: pointer;
    }
    .domain-chip.selected {
      border-color: #c9a84c;
      color: #f2c96a;
      background: rgba(58,42,12,0.45);
    }
    .domain-chip input { accent-color: #c9a84c; }
    .suggest-line {
      color: #c9a84c;
      font-size: 13px;
      margin: 0;
      line-height: 1.4;
    }
    .login-card { max-width: 520px; }
  `]
})
export class LoginComponent {
  username = '';
  password = '';
  passwordConfirm = '';
  birthDate = '';
  classDisplayName = '';
  selectedDomains: string[] = [];
  mode = signal<LoginMode>('login');
  signupStep = signal<1 | 2>(1);
  domainOptions = signal<string[]>([]);
  suggestedClass = signal<{ id: string; name: string; tagline: string } | null>(null);
  isBusy = signal(false);
  errorMessage = signal('');
  successMessage = signal('');

  constructor(
    private authService: AuthService,
    private router: Router,
  ) {}

  setMode(mode: LoginMode): void {
    this.mode.set(mode);
    this.signupStep.set(1);
    this.selectedDomains = [];
    this.suggestedClass.set(null);
    this.classDisplayName = '';
    this.errorMessage.set('');
    this.successMessage.set('');
    if (mode === 'signup') {
      void this.loadDomainOptions();
    }
  }

  async loadDomainOptions(): Promise<void> {
    const res = await this.authService.getOnboardingOptions();
    if (res.success && res.domains) {
      this.domainOptions.set(res.domains);
    }
  }

  canSignupStep(): boolean {
    if (this.signupStep() === 1) {
      return (
        !!this.username &&
        this.password.length >= 8 &&
        this.password === this.passwordConfirm &&
        !!this.birthDate
      );
    }
    return this.selectedDomains.length >= 3 && this.selectedDomains.length <= 5;
  }

  toggleDomain(domain: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      if (this.selectedDomains.length >= 5) {
        (event.target as HTMLInputElement).checked = false;
        this.errorMessage.set('Select at most 5 domains.');
        return;
      }
      this.selectedDomains = [...this.selectedDomains, domain];
    } else {
      this.selectedDomains = this.selectedDomains.filter(d => d !== domain);
    }
    this.errorMessage.set('');
    void this.refreshSuggestion();
  }

  async refreshSuggestion(): Promise<void> {
    if (this.selectedDomains.length < 3) {
      this.suggestedClass.set(null);
      return;
    }
    const res = await this.authService.suggestClass(this.selectedDomains);
    if (res.success && res.template) {
      this.suggestedClass.set(res.template);
      if (!this.classDisplayName) {
        this.classDisplayName = res.template.name;
      }
    }
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

  async onDemoLogin(): Promise<void> {
    this.isBusy.set(true);
    this.errorMessage.set('');
    this.successMessage.set('');

    try {
      const result = await this.authService.demoLogin();
      if (result.success) {
        this.router.navigate(['/dashboard']);
      } else {
        this.errorMessage.set(result.error || 'Demo login failed');
      }
    } catch (error: any) {
      this.errorMessage.set(error.message || 'Network error. Please try again.');
    } finally {
      this.isBusy.set(false);
    }
  }

  async onSignupNext(): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');

    if (this.signupStep() === 1) {
      if (this.password !== this.passwordConfirm) {
        this.errorMessage.set('Passwords do not match.');
        return;
      }
      this.signupStep.set(2);
      if (!this.domainOptions().length) {
        await this.loadDomainOptions();
      }
      return;
    }

    this.isBusy.set(true);
    try {
      const result = await this.authService.signup(
        this.username,
        this.password,
        this.birthDate,
        {
          domains: this.selectedDomains,
          classDisplayName: this.classDisplayName || undefined,
        }
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
