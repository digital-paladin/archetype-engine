import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <div class="login-header">
          <h1>Set new password</h1>
          <p>Choose a strong password for your account</p>
        </div>

        <form (ngSubmit)="onSubmit()" class="login-form">
          <div class="form-group">
            <label for="password">New password</label>
            <input
              id="password"
              type="password"
              [(ngModel)]="password"
              name="password"
              placeholder="At least 8 characters"
              required
              minlength="8"
              [disabled]="isSubmitting()"
            />
          </div>

          <div class="form-group">
            <label for="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              [(ngModel)]="confirmPassword"
              name="confirmPassword"
              placeholder="Re-enter password"
              required
              [disabled]="isSubmitting()"
            />
          </div>

          @if (errorMessage()) {
            <div class="error-message">{{ errorMessage() }}</div>
          }

          <button type="submit" class="login-button" [disabled]="!canSubmit()">
            {{ isSubmitting() ? 'Saving…' : 'Update password' }}
          </button>

          <a routerLink="/login" class="back-link">Back to login</a>
        </form>
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
      padding: 20px;
    }
    .login-card {
      background: #120e07;
      border: 1px solid rgba(155,115,38,0.60);
      padding: 40px;
      max-width: 420px;
      width: 100%;
    }
    .login-header { text-align: center; margin-bottom: 28px; }
    .login-header h1 {
      font-family: 'Cinzel', serif;
      color: #f2c96a;
      font-size: 22px;
      margin: 0 0 8px;
    }
    .login-header p {
      color: #a08858;
      margin: 0;
      font-size: 12px;
    }
    .login-form { display: flex; flex-direction: column; gap: 16px; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-group label {
      font-family: 'Cinzel', serif;
      font-size: 10px;
      color: #a08858;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .form-group input {
      background: #090705;
      border: 1px solid rgba(110,82,28,0.40);
      color: #e2cfa8;
      padding: 10px 12px;
    }
    .error-message {
      background: rgba(110,20,20,0.28);
      border: 1px solid rgba(180,30,30,0.45);
      padding: 10px;
      color: #ff8888;
      font-size: 13px;
    }
    .login-button {
      background: linear-gradient(180deg, rgba(58,42,12,0.92), rgba(22,16,5,0.96));
      border: 1px solid rgba(155,115,38,0.65);
      color: #c9a84c;
      font-family: 'Cinzel', serif;
      padding: 12px;
      cursor: pointer;
    }
    .login-button:disabled { opacity: 0.4; cursor: not-allowed; }
    .back-link {
      text-align: center;
      color: #a08858;
      font-size: 12px;
      text-decoration: none;
    }
    .back-link:hover { color: #c9a84c; }
  `]
})
export class ResetPasswordComponent {
  password = '';
  confirmPassword = '';
  isSubmitting = signal(false);
  errorMessage = signal('');

  constructor(
    private authService: AuthService,
    private router: Router,
  ) {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
    }
  }

  canSubmit(): boolean {
    return (
      !this.isSubmitting() &&
      this.password.length >= 8 &&
      this.password === this.confirmPassword
    );
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) {
      if (this.password !== this.confirmPassword) {
        this.errorMessage.set('Passwords do not match.');
      }
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set('');

    const result = await this.authService.updatePassword(this.password);
    this.isSubmitting.set(false);

    if (result.success) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.errorMessage.set(result.error || 'Could not update password.');
  }
}
