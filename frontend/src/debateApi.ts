// HTTP helpers for the Group Debate feature.
// Wire shapes are kept snake_case to match the backend exactly so components
// can consume the responses without re-mapping. Mirrors `battleApi.ts` for
// fetch/error/auth conventions.

export type DebateState =
  | "waiting"
  | "prep"
  | "speaking"
  | "scoring"
  | "complete"
  | "abandoned";

export interface MotionPublic {
  id: string;
  title: string;
  text: string;
}

export interface ParticipantPublic {
  participant_id: string;
  display_name: string;
  is_ready: boolean;
  turn_index: number;
  is_forfeit: boolean;
}

export interface FinalStanding {
  participant_id: string;
  display_name: string;
  rank: number;
  ai_score: number;
  content_score: number | null;
  content_feedback: string | null;
  effective_score: number;
  is_forfeit: boolean;
  is_winner: boolean;
}

export interface PublicDebateRoom {
  code: string;
  state: DebateState;
  paused: boolean;
  motion: MotionPublic | null;
  participants: ParticipantPublic[];
  active_turn_index: number | null;
  prep_deadline: number | null;
  turn_deadline: number | null;
  reconnect_deadline: number | null;
  auto_start_deadline: number | null;  // 20s grace countdown before prep starts
  winner_participant_id: string | null;
  final_standings: FinalStanding[];
}

export interface CreateRoomResponse {
  room_code: string;
  participant_id: string;
  state: PublicDebateRoom;
}

export interface JoinRoomResponse {
  room_code: string;
  participant_id: string;
  state: PublicDebateRoom;
}

export interface ReadyResponse {
  state: PublicDebateRoom;
}

export interface TurnUploadResponse {
  turn_id: string;
  ai_score: number;
  scoring_unavailable: boolean;
  analysis_id: string | null;
  content_score: number | null;
  content_feedback: string | null;
  score_breakdown: {
    pronunciation?: { raw: number | null; weighted: number | null; weight: string };
    fluency?: { raw: number | null; weighted: number | null; weight: string };
    content?: { total: number | null; weight: string; feedback: string };
    final_score?: number;
  } | null;
  state: PublicDebateRoom;
}

export interface MyDebateEntry {
  debate_id: string;
  code: string;
  motion: MotionPublic;
  completed_at: number;
  ai_score: number | null;
  teacher_override_score: number | null;
  teacher_comment: string | null;
  winner_participant_id: string | null;
}

import { getCurrentIdToken } from "./hooks/useAuth";

// Base URL for API calls — defaults to relative path (works with Vite proxy),
// but in production uses VITE_API_URL to point to ngrok/deployed backend.
const API_BASE_URL = import.meta.env.VITE_API_URL || "";

async function authedHeaders(init?: RequestInit): Promise<Headers> {
  const headers = new Headers(init?.headers || {});
  const token = await getCurrentIdToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const fullUrl = `${API_BASE_URL}${url}`;
  const headers = await authedHeaders(init);
  const response = await fetch(fullUrl, { ...init, headers });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail =
        typeof body?.detail === "string"
          ? body.detail
          : JSON.stringify(body).slice(0, 240);
    } catch {
      detail = await response.text().catch(() => "");
    }
    const message =
      response.status === 401
        ? "Sign in first to join a debate."
        : response.status === 403
        ? `Forbidden: ${detail || "your account isn't allowed"}.`
        : response.status === 404
        ? "Debate room not found. Double-check the code."
        : response.status === 409
        ? detail === "room_full"
          ? "That debate room is already full."
          : detail === "room_not_joinable"
          ? "That debate has already started."
          : detail === "debate_paused"
          ? "Debate is paused — waiting for someone to reconnect."
          : detail === "not_your_turn"
          ? "It's not your turn to speak yet."
          : detail === "not_in_speaking_state"
          ? "Can't upload right now — debate isn't in the speaking phase."
          : detail === "not_a_participant"
          ? "You're not a participant in this debate."
          : `Debate room state issue${detail ? `: ${detail}` : ""}.`
        : response.status === 502
        ? "Scoring service is unavailable right now. Try again."
        : `${init?.method ?? "GET"} ${url} failed: ${response.status} ${
            response.statusText
          }${detail ? ` — ${detail.slice(0, 240)}` : ""}`;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

// Map a recorder MIME type (which may include a `;codecs=...` parameter the
// backend's strict allow-list rejects) to a bare MIME type plus filename
// extension the backend accepts. Same pattern as `api.ts::pickUploadMime`.
function pickUploadMime(rawType: string): { mime: string; ext: string } {
  const bare = (rawType || "").split(";")[0]?.trim().toLowerCase() || "";
  switch (bare) {
    case "audio/webm":
      return { mime: "audio/webm", ext: "webm" };
    case "audio/ogg":
      return { mime: "audio/ogg", ext: "ogg" };
    case "audio/mp4":
      return { mime: "audio/mp4", ext: "m4a" };
    case "audio/mpeg":
    case "audio/mp3":
      return { mime: "audio/mpeg", ext: "mp3" };
    case "audio/wav":
    case "audio/x-wav":
      return { mime: "audio/wav", ext: "wav" };
    default:
      return { mime: "audio/webm", ext: "webm" };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createDebateRoom(): Promise<CreateRoomResponse> {
  return fetchJson<CreateRoomResponse>("/debate/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function joinDebateRoom(code: string): Promise<JoinRoomResponse> {
  const cleaned = code.trim().toUpperCase();
  return fetchJson<JoinRoomResponse>(`/debate/rooms/${cleaned}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function flipReady(code: string): Promise<ReadyResponse> {
  const cleaned = code.trim().toUpperCase();
  return fetchJson<ReadyResponse>(`/debate/rooms/${cleaned}/ready`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function uploadTurn(
  code: string,
  audio: Blob,
): Promise<TurnUploadResponse> {
  const cleaned = code.trim().toUpperCase();
  const { mime, ext } = pickUploadMime(audio.type);
  // Re-wrap the blob so the FormData part Content-Type drops the
  // ;codecs=... parameter that the backend's allow-list rejects.
  const cleanedBlob = new Blob([audio], { type: mime });

  const formData = new FormData();
  formData.append("file", cleanedBlob, `turn.${ext}`);

  return fetchJson<TurnUploadResponse>(`/debate/rooms/${cleaned}/turn`, {
    method: "POST",
    body: formData,
  });
}

export async function fetchDebateRoom(code: string): Promise<PublicDebateRoom> {
  const cleaned = code.trim().toUpperCase();
  return fetchJson<PublicDebateRoom>(`/debate/rooms/${cleaned}`);
}

export async function fetchMotions(): Promise<MotionPublic[]> {
  const data = await fetchJson<unknown>("/debate/motions");
  if (!Array.isArray(data)) return [];
  return (data as MotionPublic[]).filter(
    (m) =>
      m &&
      typeof m.id === "string" &&
      typeof m.title === "string" &&
      typeof m.text === "string",
  );
}

export async function fetchMyDebates(): Promise<MyDebateEntry[]> {
  const data = await fetchJson<unknown>("/debate/my-debates");
  if (!Array.isArray(data)) return [];
  return data as MyDebateEntry[];
}
