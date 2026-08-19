// Typed wrappers for the /buddy/* endpoints. Same `authedHeaders` pattern as
// api.ts and adminApi.ts. The backend enforces access: a student may only
// touch a pair they belong to, and /buddy/admin/* is teacher-only.

import { getCurrentIdToken } from "./hooks/useAuth";

// ---------------------------------------------------------------------------
// Domain types — mirror the JSON shapes the backend serializes.
// ---------------------------------------------------------------------------

export type BuddyRole = "mentor" | "mentee";
export type PairStatus = "active" | "ended";
export type MentorStatus = "suggested" | "approved" | "rejected";
export type MessageKind = "text" | "voice";

export interface ConversationSummary {
  pair_id: string;
  partner_email: string;
  partner_name: string | null;
  /** "mentor" means the current user mentors the partner. */
  my_role: BuddyRole;
  status: PairStatus;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string;
}

export interface MyBuddiesResponse {
  conversations: ConversationSummary[];
  total: number;
}

export interface BuddyMessage {
  message_id: string;
  pair_id: string;
  sender_email: string;
  kind: MessageKind;
  body: string;
  audio_id: string | null;
  audio_path: string | null;
  duration_seconds: number | null;
  sent_at: string;
  read_at: string | null;
}

export interface MessagesResponse {
  pair_id: string;
  partner_email: string;
  partner_name: string | null;
  messages: BuddyMessage[];
  total: number;
}

export interface MarkReadResponse {
  marked: number;
}

/** One student's demonstrated speaking ability, as the ranking sees it. */
export interface SpeakerRanking {
  email: string;
  name: string | null;
  speaking_score: number;
  sample_size: number;
  content_avg: number | null;
  pronunciation_avg: number | null;
  /** "none" until a teacher has decided on them. */
  status: MentorStatus | "none";
  active_mentees: number;
}

export interface MentorCandidatesResponse {
  suggested: SpeakerRanking[];
  ranking: SpeakerRanking[];
  threshold: number;
  min_sample_size: number;
}

export interface MentorRecord {
  email: string;
  name: string | null;
  status: MentorStatus;
  speaking_score: number;
  sample_size: number;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface MentorsResponse {
  mentors: MentorRecord[];
  total: number;
}

export interface BuddyPair {
  pair_id: string;
  mentor_email: string;
  mentee_email: string;
  mentor_name: string | null;
  mentee_name: string | null;
  created_by: string;
  created_at: string;
  status: PairStatus;
  ended_at: string | null;
}

/**
 * Whether a pairing is running — activity only, never ability. A strong mentee
 * cannot make a pairing that has not met in a month look fine.
 */
export type PairState =
  | "ended"
  | "no_cycle"
  | "not_started"
  | "on_track"
  | "quiet"
  | "stalled";

export interface PairHealth {
  pair_id: string;
  state: PairState;
  has_cycle: boolean;
  cycle_ends_at: string | null;
  sessions: SessionConsistency;
  message_count: number;
  last_activity_at: string | null;
  /** Null only when there is no cycle to measure inside. */
  days_quiet: number | null;
}

export interface PairsResponse {
  pairs: BuddyPair[];
  total: number;
  /** Keyed by pair_id. Derived per request, so it is never stale. */
  health: Record<string, PairHealth>;
}

export type CycleStatus = "active" | "closed";
export type ActivityKind = "interview" | "debate" | "gd";

/** The mentee's standing when the cycle opened. Null means nothing to measure. */
export interface CycleBaseline {
  content: number | null;
  pronunciation: number | null;
  live_speaking: number | null;
}

export interface BuddyCycle {
  cycle_id: string;
  pair_id: string;
  mentee_email: string;
  goal: string;
  focus_area: string | null;
  starts_at: string;
  ends_at: string;
  baseline: CycleBaseline;
  status: CycleStatus;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

export interface CyclesResponse {
  cycles: BuddyCycle[];
  total: number;
}

export interface GrowthAxis {
  key: string;
  label: string;
  baseline: number | null;
  latest: number | null;
  /** Null when there is no baseline to measure against — never treat as zero. */
  delta: number | null;
  sample_size: number;
}

export interface TrendPoint {
  at: string;
  content: number | null;
  pronunciation: number | null;
  live_speaking: number | null;
}

export interface ActivityItem {
  kind: ActivityKind;
  at: string;
  title: string;
  score: number | null;
}

export type SessionStatus = "planned" | "completed" | "missed";
export type SessionMode = "async_voice" | "live_call" | "in_person";

export interface BuddySession {
  session_id: string;
  pair_id: string;
  cycle_id: string;
  topic: string;
  mode: SessionMode;
  scheduled_at: string;
  status: SessionStatus;
  completed_at: string | null;
  duration_minutes: number | null;
  mentor_notes: string;
  mentee_reflection: string;
  created_by: string;
  created_at: string;
}

export interface SessionsResponse {
  sessions: BuddySession[];
  total: number;
}

/** Did the pairing actually happen, separately from how it scored. */
export interface SessionConsistency {
  planned: number;
  completed: number;
  missed: number;
}

export interface CycleReport {
  cycle: BuddyCycle | null;
  axes: GrowthAxis[];
  trend: TrendPoint[];
  activity: ActivityItem[];
  counts: Record<string, number>;
  sessions: SessionConsistency;
  /** False when there are too few points to honestly draw a line. */
  enough_for_trend: boolean;
}

// ---------------------------------------------------------------------------
// Fetch helpers — kept private to this module. Same shape as adminApi.ts.
// ---------------------------------------------------------------------------

const API_BASE_URL = import.meta.env.VITE_API_URL || "";

async function authedHeaders(init?: RequestInit): Promise<Headers> {
  const headers = new Headers(init?.headers || {});
  const token = await getCurrentIdToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/** Pull the backend's `detail` out of an error body, falling back to raw text. */
function detailOf(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return raw;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const fullUrl = `${API_BASE_URL}${url}`;
  const headers = await authedHeaders(init);
  const response = await fetch(fullUrl, { ...init, headers });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(
      `${init?.method ?? "GET"} ${url} failed: ${response.status} ${response.statusText}${
        raw ? ` — ${detailOf(raw).slice(0, 240)}` : ""
      }`,
    );
  }
  return (await response.json()) as T;
}

function postJson<T>(url: string, body?: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

// ---------------------------------------------------------------------------
// Student — conversations
// ---------------------------------------------------------------------------

export function fetchMyBuddies(): Promise<MyBuddiesResponse> {
  return fetchJson<MyBuddiesResponse>("/buddy/me");
}

export function fetchMessages(pairId: string): Promise<MessagesResponse> {
  return fetchJson<MessagesResponse>(
    `/buddy/pairs/${encodeURIComponent(pairId)}/messages`,
  );
}

export function sendMessage(pairId: string, body: string): Promise<BuddyMessage> {
  return postJson<BuddyMessage>(
    `/buddy/pairs/${encodeURIComponent(pairId)}/messages`,
    { body },
  );
}

export function markConversationRead(pairId: string): Promise<MarkReadResponse> {
  return postJson<MarkReadResponse>(
    `/buddy/pairs/${encodeURIComponent(pairId)}/read`,
  );
}

// Map a recorder MIME type (which may carry a `;codecs=...` parameter the
// backend's strict allow-list rejects) to a bare MIME type plus a filename
// extension the backend accepts. Mirrors `pickUploadMime` in api.ts.
function pickUploadMime(rawType: string): { mime: string; ext: string } {
  const bare = (rawType || "").split(";")[0]?.trim().toLowerCase() || "";
  if (bare === "audio/webm" || bare === "video/webm") return { mime: bare, ext: "webm" };
  if (bare === "audio/ogg") return { mime: bare, ext: "ogg" };
  if (bare === "audio/mp4" || bare === "video/mp4") return { mime: bare, ext: "mp4" };
  if (bare === "audio/mpeg" || bare === "audio/mp3") return { mime: bare, ext: "mp3" };
  if (bare === "audio/wav" || bare === "audio/x-wav") return { mime: bare, ext: "wav" };
  return { mime: "audio/webm", ext: "webm" };
}

export function sendVoiceNote(pairId: string, audio: Blob): Promise<BuddyMessage> {
  const { mime, ext } = pickUploadMime(audio.type);
  const form = new FormData();
  form.append("audio", new File([audio], `voice-note.${ext}`, { type: mime }));
  // No Content-Type header — the browser sets the multipart boundary itself.
  return fetchJson<BuddyMessage>(
    `/buddy/pairs/${encodeURIComponent(pairId)}/voice-notes`,
    { method: "POST", body: form },
  );
}

/**
 * Fetch a voice note's bytes as an object URL.
 *
 * The serve route requires the bearer token, which a bare `<audio src>` cannot
 * send — so pull the blob with the header and wrap it instead. The caller owns
 * the returned URL and must `URL.revokeObjectURL` it.
 */
export async function fetchVoiceNoteUrl(messageId: string): Promise<string> {
  const url = `/buddy/messages/${encodeURIComponent(messageId)}/audio`;
  const headers = await authedHeaders();
  const response = await fetch(`${API_BASE_URL}${url}`, { headers });
  if (!response.ok) {
    throw new Error(`Could not load the voice note (${response.status}).`);
  }
  return URL.createObjectURL(await response.blob());
}

// ---------------------------------------------------------------------------
// Teacher — mentor approval and pairing
// ---------------------------------------------------------------------------

export function fetchMentorCandidates(): Promise<MentorCandidatesResponse> {
  return fetchJson<MentorCandidatesResponse>("/buddy/admin/mentor-candidates");
}

export function fetchMentors(): Promise<MentorsResponse> {
  return fetchJson<MentorsResponse>("/buddy/admin/mentors");
}

export function decideMentor(
  email: string,
  status: "approved" | "rejected",
): Promise<MentorsResponse> {
  return postJson<MentorsResponse>(
    `/buddy/admin/mentors/${encodeURIComponent(email)}/decision`,
    { status },
  );
}

export function fetchPairs(): Promise<PairsResponse> {
  return fetchJson<PairsResponse>("/buddy/admin/pairs");
}

export function createPair(
  mentorEmail: string,
  menteeEmail: string,
  cycle?: { weeks: number; goal: string; focusArea?: string | null },
): Promise<BuddyPair> {
  return postJson<BuddyPair>("/buddy/admin/pairs", {
    mentor_email: mentorEmail,
    mentee_email: menteeEmail,
    // Omitted means the backend default of a 4-week cycle; 0 pairs without one.
    ...(cycle
      ? {
          cycle_weeks: cycle.weeks,
          goal: cycle.goal,
          focus_area: cycle.focusArea ?? null,
        }
      : {}),
  });
}

/** The mentee's work for the pair's open cycle — scoped to that window only. */
export function fetchPairActivity(pairId: string): Promise<CycleReport> {
  return fetchJson<CycleReport>(
    `/buddy/pairs/${encodeURIComponent(pairId)}/activity`,
  );
}

// --- Sessions ---

export function fetchSessions(pairId: string): Promise<SessionsResponse> {
  return fetchJson<SessionsResponse>(
    `/buddy/pairs/${encodeURIComponent(pairId)}/sessions`,
  );
}

export function planSession(
  pairId: string,
  scheduledAt: string,
  topic: string,
  mode: SessionMode,
): Promise<BuddySession> {
  return postJson<BuddySession>(
    `/buddy/pairs/${encodeURIComponent(pairId)}/sessions`,
    { scheduled_at: scheduledAt, topic, mode },
  );
}

/** Completing is per-side: the note lands on whichever side is calling. */
export function completeSession(
  sessionId: string,
  note: string,
  durationMinutes?: number | null,
): Promise<BuddySession> {
  return postJson<BuddySession>(
    `/buddy/sessions/${encodeURIComponent(sessionId)}/complete`,
    { note, duration_minutes: durationMinutes ?? null },
  );
}

export function missSession(sessionId: string): Promise<BuddySession> {
  return postJson<BuddySession>(
    `/buddy/sessions/${encodeURIComponent(sessionId)}/miss`,
  );
}

export async function cancelSession(sessionId: string): Promise<void> {
  const url = `/buddy/sessions/${encodeURIComponent(sessionId)}`;
  const headers = await authedHeaders();
  const response = await fetch(`${API_BASE_URL}${url}`, {
    method: "DELETE",
    headers,
  });
  // 204: nothing to parse, so this cannot go through fetchJson.
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(
      `DELETE ${url} failed: ${response.status}${raw ? ` — ${detailOf(raw)}` : ""}`,
    );
  }
}

export function fetchCycles(): Promise<CyclesResponse> {
  return fetchJson<CyclesResponse>("/buddy/admin/cycles");
}

export function createCycle(
  pairId: string,
  weeks: number,
  goal: string,
  focusArea?: string | null,
): Promise<BuddyCycle> {
  return postJson<BuddyCycle>("/buddy/admin/cycles", {
    pair_id: pairId,
    weeks,
    goal,
    focus_area: focusArea ?? null,
  });
}

export function closeCycle(cycleId: string): Promise<BuddyCycle> {
  return postJson<BuddyCycle>(
    `/buddy/admin/cycles/${encodeURIComponent(cycleId)}/close`,
  );
}

export function endPair(pairId: string): Promise<BuddyPair> {
  return postJson<BuddyPair>(`/buddy/admin/pairs/${encodeURIComponent(pairId)}/end`);
}
