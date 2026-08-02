/**
 * roomSession — a tiny per-room client-side store over `sessionStorage`.
 *
 * Purpose: after a reload, a live-room view (debate / GD / battle) can recover
 * the non-URL, server-issued identity it needs to rejoin as the same
 * participant. The room `code` travels in the URL; the identity
 * (`participantId` for debate/GD, `playerId` + `role` for battle) lives here.
 *
 * `sessionStorage` (not `localStorage`) is deliberate: it survives a same-tab
 * reload but is cleared when the tab closes, so a closed tab never leaks a
 * stale identity into a future session.
 *
 * Keys are namespaced `spa.room.<feature>.<CODE>` with the code normalized to
 * uppercase so lookups are stable regardless of how the code was typed/cased.
 */

export type RoomFeature = "debate" | "gd" | "battle";

/** Stored identity for a debate or GD room. */
export interface DebateRoomSession {
  participantId: string;
  savedAt: number;
}

/** Stored identity for a battle room. */
export interface BattleRoomSession {
  playerId: string;
  role: string;
  savedAt: number;
}

/**
 * Map each feature to the shape of the value it stores. This lets
 * `saveRoomSession`/`readRoomSession` be strongly typed per feature: passing a
 * battle value under `"debate"` (or vice versa) is a compile error.
 */
export interface RoomSessionByFeature {
  debate: DebateRoomSession;
  gd: DebateRoomSession;
  battle: BattleRoomSession;
}

const KEY_PREFIX = "spa.room";

/** Build the namespaced storage key, normalizing the code to uppercase. */
function storageKey(feature: RoomFeature, code: string): string {
  return `${KEY_PREFIX}.${feature}.${code.toUpperCase()}`;
}

/**
 * Return the active `sessionStorage`, or `null` if it is unavailable (SSR, or
 * a browser that throws on access in private mode). All operations degrade to
 * no-ops rather than throwing.
 */
function getStore(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Persist the room identity for `<feature, code>`. Called on create/join
 * success. Overwrites any existing entry for the same key.
 */
export function saveRoomSession<F extends RoomFeature>(
  feature: F,
  code: string,
  value: RoomSessionByFeature[F],
): void {
  const store = getStore();
  if (!store) return;
  try {
    store.setItem(storageKey(feature, code), JSON.stringify(value));
  } catch {
    // Quota / serialization failure — nothing we can do, stay a no-op.
  }
}

/**
 * Read the stored identity for `<feature, code>`. Returns `null` when there is
 * no entry or the stored value is corrupt / unparseable JSON.
 */
export function readRoomSession<F extends RoomFeature>(
  feature: F,
  code: string,
): RoomSessionByFeature[F] | null {
  const store = getStore();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(storageKey(feature, code));
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as RoomSessionByFeature[F];
  } catch {
    // Corrupt JSON — tolerate by returning null.
    return null;
  }
}

/** Remove the stored identity for `<feature, code>`. Called on explicit leave/complete. */
export function clearRoomSession(feature: RoomFeature, code: string): void {
  const store = getStore();
  if (!store) return;
  try {
    store.removeItem(storageKey(feature, code));
  } catch {
    // No-op on failure.
  }
}
