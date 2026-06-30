/**
 * Authentication context/store for the Mock Interview MVP frontend (Task 10).
 *
 * Responsibilities:
 *   - Persist the JWT in `localStorage` (via the API client) and keep it in
 *     React state for the current session.
 *   - Decode the role + user id from the JWT (no client-side verification).
 *   - Expose `login`, `register`, and `logout`, plus the current `user`.
 *
 * The server remains the source of truth for authorization; the decoded role
 * is only used for UX and the `RoleRoute` client-side guard.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  apiRequest,
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from '../api/client';
import { decodeToken, isTokenExpired, type Role } from './token';

/** The authenticated user as known to the frontend (decoded from the JWT). */
export interface AuthUser {
  id: string;
  role: Role;
}

/** Payload accepted by the register form. */
export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

/** Value exposed by the auth context. */
export interface AuthContextValue {
  /** The current user, or null when logged out. */
  user: AuthUser | null;
  /** Convenience accessor for the current role. */
  role: Role | null;
  /** True when a valid (non-expired) token is present. */
  isAuthenticated: boolean;
  /** Authenticate with email + password; stores the returned token. */
  login: (email: string, password: string) => Promise<void>;
  /** Create an account; does not log the user in (they log in afterward). */
  register: (input: RegisterInput) => Promise<void>;
  /** Clear the stored token and reset the session. */
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Derives the `AuthUser` from a stored token, ignoring expired/invalid ones. */
function userFromStoredToken(): AuthUser | null {
  const token = getStoredToken();
  if (!token || isTokenExpired(token)) return null;
  const decoded = decodeToken(token);
  return decoded ? { id: decoded.sub, role: decoded.role } : null;
}

/** Provides auth state + actions to the component tree. */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(() => userFromStoredToken());

  const login = useCallback(async (email: string, password: string) => {
    const { token } = await apiRequest<{ token: string }>('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password },
    });
    const decoded = decodeToken(token);
    if (!decoded) {
      throw new Error('Received an invalid authentication token.');
    }
    setStoredToken(token);
    setUser({ id: decoded.sub, role: decoded.role });
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    await apiRequest<{ id: string; name: string; email: string; role: Role }>(
      '/auth/register',
      { method: 'POST', auth: false, body: input },
    );
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role: user?.role ?? null,
      isAuthenticated: user !== null,
      login,
      register,
      logout,
    }),
    [user, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook to consume the auth context; throws if used outside the provider. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return context;
}
