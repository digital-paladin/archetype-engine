import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * HTTP Interceptor:
 *  1. Attaches Authorization: Bearer <token> to all non-auth requests.
 *  2. On 401, silently exchanges the stored refresh_token for a new
 *     access_token and retries the original request exactly once.
 *  3. If refresh also fails, logs the user out and rethrows.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  // Auth endpoints handle their own credentials — no Bearer header needed.
  if (req.url.includes('/api/auth/')) {
    return next(req);
  }

  const token = authService.getToken();
  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError(err => {
      // Only attempt refresh on a 401 Unauthorized.
      if (err.status !== 401) return throwError(() => err);

      // Swap access token via refresh endpoint, then retry once.
      return from(authService.refresh()).pipe(
        switchMap(newToken => {
          if (!newToken) {
            authService.logout();
            return throwError(() => err);
          }
          const retryReq = req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
          return next(retryReq);
        }),
        catchError(() => {
          authService.logout();
          return throwError(() => err);
        })
      );
    })
  );
};
