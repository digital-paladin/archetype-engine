import { Component, signal, effect, inject } from '@angular/core';
import { NgZone } from '@angular/core';
import { XpProjectionService, XPProjection } from './xp-projection.service';
import { SocketService } from './socket.service';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { DashboardComponent } from './dashboard.component';
import { LoginComponent } from './login.component';
import { AuthCallbackComponent } from './auth-callback.component';
import { ResetPasswordComponent } from './reset-password.component';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'auth/callback', component: AuthCallbackComponent },
  { path: 'reset-password', component: ResetPasswordComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: '/dashboard' }
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('character-progression-ui');
  protected readonly xpProjection = signal<XPProjection | null>(null);
  protected readonly isLoading = signal(true);

  protected pulseMap: Record<string, boolean> = {};
  protected toastMessage: string | null = null;
  private toastTimeout: any = null;

  private readonly xpProjectionService = inject(XpProjectionService);
  private readonly socketService = inject(SocketService);
  private readonly ngZone = inject(NgZone);

  private previousXP: Record<string, number> = {};

  constructor() {
    // Initial fetch
    console.log('[XP DEBUG] Fetching XP projection...');

    this.xpProjectionService.getProjections().subscribe({
      next: (data: any) => {
        console.log('[XP DEBUG] XP projection loaded:', data);
        this.xpProjection.set(data);
        this.isLoading.set(false);
        this.savePreviousXP(data);
      },
      error: (err: any) => {
        console.error('[XP DEBUG] Failed to load XP projection:', err);
        this.isLoading.set(false);
      }
    });

    // Listen for real-time updates
    this.socketService.onXpProjectionUpdate().subscribe((data: any) => {
      console.log('[XP DEBUG] Real-time XP projection update:', data);
      this.handleXPUpdate(data);
      this.xpProjection.set(data);
    });
  }

  private savePreviousXP(data: XPProjection) {
    Object.keys(data).forEach(className => {
      this.previousXP[className] = data[className].totalXP;
    });
  }

  private handleXPUpdate(data: XPProjection) {
    Object.keys(data).forEach(className => {
      const prev = this.previousXP[className] ?? 0;
      const curr = data[className].totalXP;
      if (curr > prev) {
        this.triggerPulse(className);
        this.showToast(`${className}: +${curr - prev} XP!`);
      }
      this.previousXP[className] = curr;
    });
  }

  private triggerPulse(className: string) {
    this.pulseMap[className] = true;
    setTimeout(() => {
      this.ngZone.run(() => {
        this.pulseMap[className] = false;
      });
    }, 700);
  }

  private showToast(message: string) {
    this.toastMessage = message;
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.ngZone.run(() => {
        this.toastMessage = null;
      });
    }, 1800);
  }

  getClassNames(): string[] {
    const projection = this.xpProjection();
    return projection ? Object.keys(projection) : [];
  }
}
