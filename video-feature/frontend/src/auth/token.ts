/**
 * JWT decoding helpers for the frontend (Task 10).
 *
 * The frontend never *verifies* the JWT (the backend remains the source of
 * truth); it only decodes the payload to read the user's role for client-side
 * routing (`RoleRoute`) and UI. Decoding is a base64url decode of the middle
 * segment — no signature check, by design.
 */

/** Roles carried in the JWT `role` claim. */
export type Role = 'student' | 'teacher';

/** Decoded JWT claims the frontend cares about (mirrors the backend's). */
export interface DecodedToken {
  /** Subject — the user's id. */
  sub: string;
  /** The user's role. */
  role: Role;
  /** Expiry (seconds since epoch), if present. */
  exp?: number;
}

/** Decodes a base64url string to UTF-8 text. */
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  // `atob` is available in the browser; decode to a UTF-8 string.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Decodes the payload of a JWT without verifying its signature.
 *
 * Returns `null` for malformed tokens or payloads missing the expected claims.
 */
export function decodeToken(token: string): DecodedToken | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const json = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    const sub = json.sub;
    const role = json.role;
    if (typeof sub !== 'string') return null;
    if (role !== 'student' && role !== 'teacher') return null;

    return {
      sub,
      role,
      exp: typeof json.exp === 'number' ? json.exp : undefined,
    };
  } catch {
    return null;
  }
}

/** Returns true when the token carries an `exp` claim that is in the past. */
export function isTokenExpired(token: string): boolean {
  const decoded = decodeToken(token);
  if (!decoded?.exp) return false;
  return decoded.exp * 1000 <= Date.now();
}
