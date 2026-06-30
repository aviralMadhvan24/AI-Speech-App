/**
 * API client for the Mock Interview MVP frontend (Task 10).
 *
 * A thin `fetch` wrapper that:
 *   - base-URLs the Express backend (via `VITE_API_URL`, defaulting to the Vite
 *     dev proxy prefix `/api`, which forwards to http://localhost:3000),
 *   - attaches the stored JWT as an `Authorization: Bearer <token>` header,
 *   - serializes/parses JSON, and
 *   - surfaces backend errors as a typed `ApiError` so callers can show
 *     field-level validation messages.
 *
 * The token is read lazily from `localStorage` on each request so the client
 * stays in sync with login/logout without needing to be re-instantiated.
 */

/** Key under which the JWT is persisted in `localStorage`. */
export const TOKEN_STORAGE_KEY = 'mock-interview.token';

/**
 * Base URL for API calls. In development the default `/api` is rewritten by the
 * Vite proxy to the backend root (see `vite.config.ts`). In other environments
 * set `VITE_API_URL` (e.g. `https://api.example.com`).
 */
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');

/** Reads the persisted JWT, or `null` when the user is not logged in. */
export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persists the JWT for later requests. */
export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/** Removes the persisted JWT (used on logout). */
export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/**
 * Error thrown when the backend responds with a non-2xx status. Carries the
 * HTTP status and any structured `details` (field-level validation messages)
 * the backend returned.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: Record<string, string>;

  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Options accepted by the request helper. */
export interface RequestOptions {
  /** HTTP method; defaults to GET. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serializable request body. */
  body?: unknown;
  /** Whether to attach the stored JWT; defaults to true. */
  auth?: boolean;
  /** Additional headers to merge in. */
  headers?: Record<string, string>;
}

/**
 * Performs a JSON request against the backend and returns the parsed body.
 *
 * Throws `ApiError` for non-2xx responses, surfacing the backend's `error`
 * message and optional `details` map.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, headers = {} } = options;

  const finalHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (auth) {
    const token = getStoredToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError(0, 'Unable to reach the server. Please try again.', undefined);
  }

  // Parse JSON when present; tolerate empty bodies (e.g. 204).
  const text = await response.text();
  const payload = text.length > 0 ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : undefined) ?? `Request failed with status ${response.status}`;
    const details =
      payload && typeof payload === 'object' && 'details' in payload
        ? ((payload as { details?: Record<string, string> }).details)
        : undefined;
    throw new ApiError(response.status, message, details);
  }

  return payload as T;
}

/** Options accepted by the multipart upload helper. */
export interface UploadOptions {
  /** HTTP method; defaults to POST. */
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Whether to attach the stored JWT; defaults to true. */
  auth?: boolean;
  /** Additional headers to merge in (do NOT set Content-Type for FormData). */
  headers?: Record<string, string>;
}

/**
 * Performs a `multipart/form-data` request against the backend and returns the
 * parsed body.
 *
 * Unlike {@link apiRequest}, this helper sends a `FormData` body and
 * deliberately does NOT set a `Content-Type` header: the browser sets it
 * automatically, including the multipart boundary. Used for video uploads to
 * `POST /submissions` (field name `video`, plus `questionId`).
 *
 * Throws `ApiError` for non-2xx responses, mirroring {@link apiRequest}.
 */
export async function apiUpload<T>(
  path: string,
  formData: FormData,
  options: UploadOptions = {},
): Promise<T> {
  const { method = 'POST', auth = true, headers = {} } = options;

  // Intentionally omit Content-Type so the browser supplies the multipart
  // boundary; only merge caller-provided headers and the auth token.
  const finalHeaders: Record<string, string> = { ...headers };
  if (auth) {
    const token = getStoredToken();
    if (token) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: formData,
    });
  } catch {
    throw new ApiError(0, 'Unable to reach the server. Please try again.', undefined);
  }

  const text = await response.text();
  const payload = text.length > 0 ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : undefined) ?? `Request failed with status ${response.status}`;
    const details =
      payload && typeof payload === 'object' && 'details' in payload
        ? (payload as { details?: Record<string, string> }).details
        : undefined;
    throw new ApiError(response.status, message, details);
  }

  return payload as T;
}

/**
 * Fetches a binary resource (e.g. a video) from an authenticated endpoint and
 * returns an object URL for it.
 *
 * A raw `<video src="/submissions/:id/video">` cannot send an
 * `Authorization` header, and the backend serves videos behind `requireAuth`.
 * So we fetch the resource as a `Blob` with the Bearer token attached and wrap
 * it in an object URL the caller can assign to a `<video>` element.
 *
 * The caller is responsible for revoking the returned URL with
 * `URL.revokeObjectURL` once the element no longer needs it.
 *
 * Throws `ApiError` for non-2xx responses, mirroring {@link apiRequest}.
 */
export async function apiBlobUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers });
  } catch {
    throw new ApiError(0, 'Unable to reach the server. Please try again.', undefined);
  }

  if (!response.ok) {
    const text = await response.text();
    const payload = text.length > 0 ? safeJsonParse(text) : undefined;
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : undefined) ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, undefined);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Downloads a file from an authenticated endpoint and triggers a browser
 * "Save As" via a temporary anchor.
 *
 * Like {@link apiBlobUrl}, this attaches the Bearer token so endpoints behind
 * `requireAuth` (e.g. `GET /teacher/report.csv`) can be fetched — a plain
 * `<a href>` cannot send an `Authorization` header. The resulting object URL is
 * revoked once the download has been triggered.
 *
 * Throws `ApiError` for non-2xx responses, mirroring {@link apiRequest}.
 */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers });
  } catch {
    throw new ApiError(0, 'Unable to reach the server. Please try again.', undefined);
  }

  if (!response.ok) {
    const text = await response.text();
    const payload = text.length > 0 ? safeJsonParse(text) : undefined;
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : undefined) ?? `Request failed with status ${response.status}`;
    throw new ApiError(response.status, message, undefined);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Parses JSON, returning the raw string when parsing fails. */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
