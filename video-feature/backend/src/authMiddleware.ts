/**
 * Authentication and role-authorization middleware for the Mock Interview MVP
 * (Requirements 1.5, 1.6).
 *
 * Exposes:
 *   - `requireAuth`        — verifies the HS256 JWT from the `Authorization:
 *                            Bearer <token>` header. Rejects missing/invalid
 *                            tokens with 401 and, on success, attaches the
 *                            decoded user (`{ id, role }`) to `req.user`.
 *   - `requireRole(role)`  — guard factory that returns 403 when the
 *                            authenticated user's role does not match.
 *
 * The decoded user is exposed on `req.user` via a global Express `Request`
 * augmentation (see below) so downstream routers can read it in a typed way.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret, type AuthTokenClaims } from './auth';
import type { Role } from './types';

/** The authenticated user attached to the request after `requireAuth`. */
export interface AuthenticatedUser {
  /** The user's id (from the JWT `sub` claim). */
  id: string;
  /** The user's role, used for role-based authorization. */
  role: Role;
}

// Augment Express's Request so `req.user` is typed for downstream handlers.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `requireAuth` once a valid JWT is verified. */
      user?: AuthenticatedUser;
    }
  }
}

/** Extracts a bearer token from an `Authorization` header value. */
function extractBearerToken(header: string | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer (.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/** Narrows an unknown decoded token to our expected claim shape. */
function isAuthTokenClaims(value: unknown): value is AuthTokenClaims {
  if (typeof value !== 'object' || value === null) return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.sub === 'string' &&
    claims.sub.length > 0 &&
    (claims.role === 'student' || claims.role === 'teacher')
  );
}

/**
 * Verifies the JWT on the request and attaches the decoded user to `req.user`.
 *
 * Returns 401 when the token is missing, malformed, expired, or signed with a
 * different key/algorithm (Requirement 1.5).
 */
export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    // Restrict to HS256 so a token signed with another algorithm is rejected.
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });

    if (!isAuthTokenClaims(decoded)) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    req.user = { id: decoded.sub, role: decoded.role };
    return next();
  } catch {
    // Covers expired, malformed, and signature-mismatch tokens.
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
};

/**
 * Builds a guard that allows the request through only when the authenticated
 * user's role matches `role`; otherwise responds 403 (Requirement 1.6).
 *
 * Must be mounted after `requireAuth`. If `req.user` is absent (guard used
 * without prior authentication), it responds 401 defensively.
 */
export function requireRole(role: Role): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}
