import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * Auth Guard - protects routes from unauthorized access
 * Redirects to login if not authenticated
 */
export const authGuard = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Check if user has token
  if (!authService.isAuthenticated()) {
    console.log('❌ No auth token, redirecting to login');
    return router.createUrlTree(['/login']);
  }

  // Verify token is still valid
  const isValid = await authService.verifyToken();
  
  if (!isValid) {
    console.log('❌ Token invalid, redirecting to login');
    return router.createUrlTree(['/login']);
  }

  console.log('✅ Auth valid, allowing access');
  return true;
};
