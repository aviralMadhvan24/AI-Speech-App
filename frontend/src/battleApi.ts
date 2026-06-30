// HTTP helpers for the 1v1 battle feature.
// Keeps wire shapes snake_case to match the backend exactly so components
// can consume them without re-mapping.

export type BattleStatus =
  | "waiting"
  | "ready"
  | "countdown"
  | "recording"
  | "scoring"
  | "complete"
  | "abandoned";

export type Verdict = "host" | "opponent" | "tie";
export type WinnerVerdict = "host" | "opponent" | "draw";
export type PlayerRole = "host" | "opponent";

export interface BattlePrompt {
  id: string;
  text: string;
  difficulty: string;
  focus_word?: string | null;
  hint?: string | null;
}

export interface PlayerScore {
  pronunciation_score: number;
  clarity_score: number;
  pace_wpm: number;
  analysis_id: string;
}

export interface BattleScores {
  host: PlayerScore | null;
  opponent: PlayerScore | null;
}

export interface StarVerdict {
  pronunciation: Verdict;
  clarity: Verdict;
  pace: Verdict;
  winner: WinnerVerdict;
  host_stars: number;
  opponent_stars: number;
}

export interface RoomState {
  room_code: string;
  status: BattleStatus;
  host_name: string;
  opponent_name: string | null;
  prompt: BattlePrompt | null;
  host_ready: boolean;
  opponent_ready: boolean;
  scores: BattleScores | null;
  verdict: StarVerdict | null;
  error: string | null;
  phase_deadline: number | null;
}

export interface CreateRoomResponse {
  room_code: string;
  player_id: string;
  role: PlayerRole;
  state: RoomState;
}

export interface JoinRoomResponse {
  room_code: string;
  player_id: string;
  role: PlayerRole;
  state: RoomState;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
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
      response.status === 404
        ? "Room not found. Double-check the code."
        : response.status === 409
        ? detail === "room_full"
          ? "That room is already full."
          : "Room can no longer be joined."
        : `${init?.method ?? "GET"} ${url} failed: ${response.status} ${
            response.statusText
          }${detail ? ` — ${detail.slice(0, 240)}` : ""}`;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function createRoom(playerName: string): Promise<CreateRoomResponse> {
  return fetchJson<CreateRoomResponse>("/battle/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host_name: playerName }),
  });
}

export async function joinRoom(
  code: string,
  playerName: string,
): Promise<JoinRoomResponse> {
  const cleaned = code.trim().toUpperCase();
  return fetchJson<JoinRoomResponse>(`/battle/rooms/${cleaned}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opponent_name: playerName }),
  });
}

export async function fetchRoomState(code: string): Promise<RoomState> {
  return fetchJson<RoomState>(`/battle/rooms/${code.trim().toUpperCase()}`);
}
