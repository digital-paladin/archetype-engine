import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        @if (errorMessage()) {
          <div class="login-header">
            <h1>Sign-in failed</h1>
            <p class="error-text">{{ errorMessage() }}</p>
            <a routerLink="/login" class="link-button">Back to login</a>
          </div>
        } @else {
          <div class="login-header">
            <h1>Completing sign-in…</h1>
            <p>Please wait</p>
          </div>
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
      padding: 20px;
    }
    .login-card {
      background: #120e07;
      border: 1px solid rgba(155,115,38,0.60);
      padding: 40px;
      max-width: 420px;
      width: 100%;
      text-align: center;
    }
    .login-header h1 {
      font-family: 'Cinzel', serif;
      color: #f2c96a;
      font-size: 22px;
      margin: 0 0 12px;
    }
    .login-header p { color: #a08858; margin: 0; }
    .error-text { color: #ff8888; margin-bottom: 20px; }
    .link-button {
      color: #c9a84c;
      text-decoration: none;
      font-family: 'Cinzel', serif;
      letter-spacing: 1px;
    }
  `]
})
export class AuthCallbackComponent implements OnInit {
  errorMessage = signal('');

  constructor(
    private authService: AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    const result = this.authService.consumeAuthCallbackFromUrl();

    if (!result.success) {
      this.errorMessage.set(result.error || 'Invalid or expired link.');
      return;
    }

    if (result.type === 'recovery') {
      this.router.navigate(['/reset-password']);
      return;
    }

    this.router.navigate(['/dashboard']);
  }
}
