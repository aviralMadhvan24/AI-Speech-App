import type {
  AnalyzeRaw,
  Difficulty,
  ScoreResult,
  Sentence,
  SessionPreview,
  WordResult,
} from "./types";

// --- Wire types (internal to this module) ---

interface PromptWire {
  id: string;
  text: string;
  focus_word?: string;
  difficulty: Difficulty;
  hint?: string;
}

interface AttemptWire {
  analysis_id: string;
  created_at: string;
  expected_text: string | null;
  transcript: string | null;
  language: string | null;
  duration_seconds: number | null;
  pronunciation_provider: string | null;
  pronunciation_available: boolean;
  pronunciation_score: number | null;
  clarity_score: number | null;
  pace_wpm: number | null;
  mistakes_count: number;
}

interface AttemptsWire {
  attempts: AttemptWire[];
  total: number;
}

// --- Fetch helpers ---

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${init?.method ?? "GET"} ${url} failed: ${response.status} ${response.statusText}${
        detail ? ` — ${detail.slice(0, 240)}` : ""
      }`,
    );
  }
  return (await response.json()) as T;
}

// --- Public API ---

export async function fetchSentences(): Promise<Sentence[]> {
  const data = await fetchJson<unknown>("/battle/prompts");
  if (!Array.isArray(data)) return [];
  return (data as PromptWire[])
    .filter((p) => p && typeof p.id === "string" && typeof p.text === "string")
    .map<Sentence>((p) => ({
      id: p.id,
      text: p.text,
      difficulty: (p.difficulty ?? "medium") as Difficulty,
      ...(p.focus_word ? { focusWord: p.focus_word } : {}),
      ...(p.hint ? { hint: p.hint } : {}),
    }));
}

// Map a recorder MIME type (which may include a `;codecs=...` parameter the
// backend's strict allow-list rejects) to a bare MIME type plus filename
// extension the backend accepts.
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
      // Default to webm — MediaRecorder on Chrome/Firefox uses it.
      return { mime: "audio/webm", ext: "webm" };
  }
}

export async function scoreAudio(
  audio: Blob,
  sentence: Sentence,
): Promise<{ result: ScoreResult; raw: AnalyzeRaw }> {
  const { mime, ext } = pickUploadMime(audio.type);
  // Re-wrap the blob so the FormData part Content-Type drops the
  // ;codecs=... parameter that the backend's allow-list rejects.
  const cleaned = new Blob([audio], { type: mime });

  const formData = new FormData();
  formData.append("file", cleaned, `recording.${ext}`);
  formData.append("expected_text", sentence.text);

  const raw = await fetchJson<AnalyzeRaw>("/analyze", {
    method: "POST",
    body: formData,
  });

  // Build a lookup from expected word -> heard word from debug.transcript_mistakes.
  const mistakeMap = new Map<string, string>();
  for (const mistake of raw.debug?.transcript_mistakes ?? []) {
    if (mistake?.expected_word) {
      mistakeMap.set(
        String(mistake.expected_word).toLowerCase(),
        mistake.heard_word ? String(mistake.heard_word) : "",
      );
    }
  }

  const pronunciationAvailable = !!raw.pronunciation?.available;
  const pronunciationWords = raw.pronunciation?.words ?? [];

  let wordResults: WordResult[] = [];

  if (pronunciationWords.length > 0) {
    wordResults = pronunciationWords.map<WordResult>((w) => {
      const expectedLc = String(w.word).toLowerCase();
      const heardRaw = mistakeMap.get(expectedLc);
      const heardDiffers = !!heardRaw && heardRaw.toLowerCase() !== expectedLc;
      const score = typeof w.score === "number" ? w.score : undefined;
      const correct = pronunciationAvailable
        ? (score ?? 0) >= 70
        : !mistakeMap.has(expectedLc);
      return {
        word: w.word,
        correct,
        ...(heardDiffers ? { heard: heardRaw } : {}),
        ...(typeof score === "number" ? { score } : {}),
        ...(w.feedback ? { feedback: w.feedback } : {}),
      };
    });
  } else {
    // No pronunciation.words from the model — fall back to splitting the expected
    // text and marking each word using transcript_mistakes only.
    const tokens = sentence.text.split(/\s+/).filter(Boolean);
    wordResults = tokens.map<WordResult>((token) => {
      const cleaned = token.replace(/[^A-Za-z']/g, "");
      const lc = cleaned.toLowerCase();
      const mistake = lc ? mistakeMap.get(lc) : undefined;
      return {
        word: cleaned || token,
        correct: !mistake,
        ...(mistake ? { heard: mistake } : {}),
      };
    });
  }

  const overall =
    typeof raw.pronunciation?.overall_score === "number"
      ? raw.pronunciation.overall_score
      : 0;

  const transcriptText =
    raw.transcription?.text ?? raw.transcription?.normalized_text ?? "";

  const result: ScoreResult = {
    sessionId: raw.analysis_id,
    transcript: transcriptText,
    targetText: sentence.text,
    score: Math.round(overall),
    wordResults,
    wpm: Number(raw.fluency?.words_per_minute ?? 0),
    durationSeconds: Number(raw.audio?.duration_seconds ?? 0),
    difficulty: sentence.difficulty,
    ...(typeof raw.fluency?.clarity_score === "number"
      ? { clarityScore: raw.fluency.clarity_score }
      : {}),
    ...(raw.pronunciation?.provider
      ? { provider: raw.pronunciation.provider }
      : {}),
    available: pronunciationAvailable,
  };

  return { result, raw };
}

export async function fetchSessions(): Promise<SessionPreview[]> {
  const data = await fetchJson<AttemptsWire>("/attempts?limit=50");
  const attempts = Array.isArray(data?.attempts) ? data.attempts : [];
  return attempts.map<SessionPreview>((a) => ({
    sessionId: a.analysis_id,
    createdAt: a.created_at,
    score: a.pronunciation_score,
    durationSeconds: a.duration_seconds,
    sentencePreview: a.expected_text || a.transcript || "(no prompt)",
    available: !!a.pronunciation_available,
  }));
}
