import { getCurrentIdToken } from "./hooks/useAuth";

export interface PotdChallenge {
  id: string;
  type: "pronunciation" | "interview";
  title: string;
  prompt: string;
  hint: string;
  category: string;
  date: string;
  completed: boolean;
  score: number | null;
  current_streak: number;
  best_streak: number;
  badge: string | null;
}

async function potdFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getCurrentIdToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) throw new Error(`POTD request failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export function fetchPotd(): Promise<PotdChallenge> {
  return potdFetch<PotdChallenge>("/potd/today");
}

export function completePotd(id: string, score: number, resultId = "") {
  return potdFetch<PotdChallenge>(`/potd/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score, result_id: resultId }),
  });
}
