// HTTP helpers for Group Discussion feature.

export type GDState =
  | "waiting"
  | "prep"
  | "discussion"
  | "scoring"
  | "complete"
  | "abandoned";

export interface GDTopic {
  id: string;
  title: string;
  text: string;
  category: string;
}

export interface GDParticipantPublic {
  participant_id: string;
  display_name: string;
  is_ready: boolean;
  is_currently_speaking: boolean;
  speech_count: number;
  total_speak_seconds: number;
}

export interface GDActiveSpeaker {
  participant_id: string;
  display_name: string;
  started_at: number;
}

export interface PublicGDRoom {
  code: string;
  state: GDState;
  topic: GDTopic | null;
  participants: GDParticipantPublic[];
  active_speakers: GDActiveSpeaker[];
  prep_deadline: number | null;
  discussion_deadline: number | null;
  auto_start_deadline: number | null;
  daily_room_url: string | null;
  scoring_started_at: number | null;
  total_speeches: number;
}

export interface CreateGDRoomResponse {
  room_code: string;
  participant_id: string;
  state: PublicGDRoom;
}

export interface JoinGDRoomResponse {
  room_code: string;
  participant_id: string;
  state: PublicGDRoom;
}

export interface ReadyGDResponse {
  state: PublicGDRoom;
}

export interface StartSpeechResponse {
  speech_id: string;
  started_at: number;
  is_interruption: boolean;
  concurrent_speakers: string[];
}

export interface EndSpeechResponse {
  speech_id: string;
  duration_seconds: number;
  audio_uploaded: boolean;
  state: PublicGDRoom;
}

export interface GDParticipantScore {
  participant_id: string;
  display_name: string;
  total_score: number;
  content_quality: number;
  communication: number;
  participation: number;
  listening: number;
  leadership: number;
  speech_count: number;
  total_speak_seconds: number;
  interruption_count: number;
  was_interrupted_count: number;
  feedback: string | null;
  rank: number;
}

export interface GDResultsResponse {
  session_id: string;
  code: string;
  topic: GDTopic;
  scores: GDParticipantScore[];
  total_speeches: number;
  duration_seconds: number;
}

import { getCurrentIdToken } from "./hooks/useAuth";

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
      detail = typeof body?.detail === "string" ? body.detail : "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    const message =
      response.status === 401
        ? "Sign in first to join a discussion."
        : response.status === 403
        ? `Forbidden: ${detail}`
        : response.status === 404
        ? "GD room not found."
        : response.status === 409
        ? detail === "room_full"
          ? "GD room is full (max 10)."
          : detail === "room_not_joinable"
          ? "Discussion has already started."
          : detail === "not_in_discussion"
          ? "Cannot speak - not in discussion phase."
          : detail === "already_speaking"
          ? "You are already speaking!"
          : detail === "results_not_ready"
          ? "Results not ready yet."
          : `Error: ${detail}`
        : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

function pickUploadMime(rawType: string): { mime: string; ext: string } {
  const bare = (rawType || "").split(";")[0]?.trim().toLowerCase() || "";
  switch (bare) {
    case "audio/webm":
      return { mime: "audio/webm", ext: "webm" };
    case "audio/ogg":
      return { mime: "audio/ogg", ext: "ogg" };
    case "audio/mp4":
      return { mime: "audio/mp4", ext: "m4a" };
    case "audio/wav":
    case "audio/x-wav":
      return { mime: "audio/wav", ext: "wav" };
    default:
      return { mime: "audio/webm", ext: "webm" };
  }
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function createGDRoom(): Promise<CreateGDRoomResponse> {
  return fetchJson<CreateGDRoomResponse>("/gd/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function joinGDRoom(code: string): Promise<JoinGDRoomResponse> {
  const cleaned = code.trim().toUpperCase();
  return fetchJson<JoinGDRoomResponse>(`/gd/rooms/${cleaned}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function flipGDReady(code: string): Promise<ReadyGDResponse> {
  const cleaned = code.trim().toUpperCase();
  return fetchJson<ReadyGDResponse>(`/gd/rooms/${cleaned}/ready`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function startSpeech(code: string): Promise<StartSpeechResponse> {
  const cleaned = code.trim().toUpperCase();
  return fetchJson<StartSpeechResponse>(`/gd/rooms/${cleaned}/speech/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function endSpeech(
  code: string,
  speechId: string,
  audio: Blob | null,
): Promise<EndSpeechResponse> {
  const cleaned = code.trim().toUpperCase();
  const formData = new FormData();
  if (audio && audio.size > 0) {
    const { mime, ext } = pickUploadMime(audio.type);
    const cleanedBlob = new Blob([audio], { type: mime });
    formData.append("file", cleanedBlob, `speech.${ext}`);
  }
  return fetchJson<EndSpeechResponse>(
    `/gd/rooms/${cleaned}/speech/${speechId}/end`,
    {
      method: "POST",
      body: formData,
    },
  );
}

export async function endDiscussion(code: string) {
  const cleaned = code.trim().toUpperCase();
  return fetchJson(`/gd/rooms/${cleaned}/end`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function getGDResults(code: string): Promise<GDResultsResponse> {
  const cleaned = code.trim().toUpperCase();
  return fetchJson<GDResultsResponse>(`/gd/rooms/${cleaned}/results`);
}

export async function fetchGDTopics(): Promise<GDTopic[]> {
  const data = await fetchJson<unknown>("/gd/topics");
  if (!Array.isArray(data)) return [];
  return data as GDTopic[];
}

export async function fetchMyGDSessions() {
  const data = await fetchJson<unknown>("/gd/my-sessions");
  if (!Array.isArray(data)) return [];
  return data;
}
