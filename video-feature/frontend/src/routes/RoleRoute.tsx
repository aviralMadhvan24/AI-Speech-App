/**
 * Client-side route guard for the Mock Interview MVP (Task 10).
 *
 * `RoleRoute` is defense-in-depth only — the backend's `requireAuth` /
 * `requireRole` middleware remains the source of truth (Requirements 1.5, 1.6).
 * This guard improves UX by:
 *   - redirecting unauthenticated users to the login page (Req 1.5), and
 *   - redirecting users with the wrong role away from pages they cannot use
 *     (Req 1.6).
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { Role } from '../auth/token';

export interface RoleRouteProps {
  /**
   * Role required to view the nested routes. When omitted, any authenticated
   * user may view them.
   */
  allow?: Role;
}

/**
 * Renders the nested routes (`<Outlet />`) when the user is authenticated and,
 * if `allow` is set, has the matching role. Otherwise redirects:
 *   - to `/login` when unauthenticated (preserving the attempted location), or
 *   - to the user's own role landing page when the role does not match.
 */
export function RoleRoute({ allow }: RoleRouteProps): JSX.Element {
  const { isAuthenticated, role } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Send unauthenticated users to login, remembering where they were headed.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allow && role !== allow) {
    // Wrong role: bounce to the user's correct landing page.
    const fallback = role === 'teacher' ? '/teacher' : '/student';
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}
