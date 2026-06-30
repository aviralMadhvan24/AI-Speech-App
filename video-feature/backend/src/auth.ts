/**
 * Auth router for the Mock Interview MVP (Requirement 1.1–1.4).
 *
 * Exposes:
 *   - POST /auth/register — create an account with a role (student | teacher).
 *   - POST /auth/login    — authenticate and return a signed JWT.
 *
 * Passwords are hashed with bcrypt; tokens are HS256 JWTs carrying the user id
 * (`sub`) and `role` claims so downstream middleware (Task 6.2) can authorize
 * requests statelessly. Invalid logins return a generic 401 to avoid leaking
 * whether an email exists (no user enumeration).
 */

import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import type { Role } from './types';

/** Cost factor for bcrypt hashing — 10 is a sensible default for an MVP. */
const BCRYPT_ROUNDS = 10;

/** JWT lifetime; kept short-lived but convenient for the MVP. */
const TOKEN_TTL: SignOptions['expiresIn'] = '12h';

const VALID_ROLES: readonly Role[] = ['student', 'teacher'];

/** Shape of the JWT payload signed on login and verified by `requireAuth`. */
export interface AuthTokenClaims {
  /** Subject — the user's id. */
  sub: string;
  /** The user's role, used for role-based authorization. */
  role: Role;
}

/**
 * Reads the JWT signing secret from the environment.
 *
 * Throwing when unset (outside tests) prevents the server from silently signing
 * tokens with a weak/empty key.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable must be set');
  }
  // Development/test fallback so the app boots without extra setup.
  return 'dev-insecure-secret-change-me';
}

/** Basic email shape check — intentionally permissive for an MVP. */
function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function createAuthRouter(): Router {
  const router = Router();

  // POST /auth/register — create an account (Req 1.1, 1.2).
  router.post('/register', async (req: Request, res: Response) => {
    const { name, email, password, role } = req.body ?? {};
    const details: Record<string, string> = {};

    if (typeof name !== 'string' || name.trim().length === 0) {
      details.name = 'Name is required.';
    }
    if (!isValidEmail(email)) {
      details.email = 'A valid email is required.';
    }
    if (typeof password !== 'string' || password.length < 6) {
      details.password = 'Password must be at least 6 characters.';
    }
    if (role !== 'student' && role !== 'teacher') {
      details.role = "Role must be either 'student' or 'teacher'.";
    }

    if (Object.keys(details).length > 0) {
      return res.status(400).json({ error: 'Invalid registration input', details });
    }

    const normalizedEmail = (email as string).trim().toLowerCase();

    try {
      const passwordHash = await bcrypt.hash(password as string, BCRYPT_ROUNDS);
      const user = await prisma.user.create({
        data: {
          name: (name as string).trim(),
          email: normalizedEmail,
          passwordHash,
          role: role as Role,
        },
      });

      return res.status(201).json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      });
    } catch (err) {
      // Unique constraint violation on email -> duplicate account (Req 1.2).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      // eslint-disable-next-line no-console
      console.error('Registration failed:', err);
      return res.status(500).json({ error: 'Registration failed.' });
    }
  });

  // POST /auth/login — authenticate and return a JWT (Req 1.3, 1.4).
  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string') {
      // Same generic response as bad credentials to avoid enumeration.
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
      const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

      // Generic 401 whether the user is missing or the password is wrong (Req 1.4).
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const passwordMatches = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const claims: AuthTokenClaims = { sub: user.id, role: user.role as Role };
      const token = jwt.sign(claims, getJwtSecret(), {
        algorithm: 'HS256',
        expiresIn: TOKEN_TTL,
      });

      return res.status(200).json({ token });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Login failed:', err);
      return res.status(500).json({ error: 'Login failed.' });
    }
  });

  return router;
}
