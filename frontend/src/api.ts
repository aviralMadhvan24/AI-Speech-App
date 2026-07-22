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
      // Word is correct only if:
      // 1. Phoneme score >= 80 (stricter threshold)
      // 2. AND transcript didn't hear a different word
      const correct = pronunciationAvailable
        ? (score ?? 0) >= 80 && !heardDiffers
        : !mistakeMap.has(expectedLc);
      return {
        word: w.word,
        correct,
        ...(heardDiffers ? { heard: heardRaw } : {}),
        ...(typeof score === "number" ? { score } : {}),
        ...(w.feedback ? { feedback: w.feedback } : {}),
        ...(Array.isArray(w.expected_phonemes) && w.expected_phonemes.length > 0
          ? { expectedPhonemes: w.expected_phonemes }
          : {}),
        ...(Array.isArray(w.observed_phonemes) && w.observed_phonemes.length > 0
          ? { observedPhonemes: w.observed_phonemes }
          : {}),
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

// ---------------------------------------------------------------------------
// Interview Studio
// ---------------------------------------------------------------------------

export interface InterviewGestureMetric {
  name: string;
  score: number | null;
  flag: string;
}

export async function submitInterviewForReview(payload: {
  sessionId: string;
  questionId: string;
  questionPrompt: string;
  questionCategory: string;
  gestureScore: number;
  metrics: InterviewGestureMetric[];
  durationSeconds: number;
}): Promise<{ submissionId: string }> {
  const body = {
    question_id: payload.questionId,
    question_prompt: payload.questionPrompt,
    question_category: payload.questionCategory,
    gesture_session_id: payload.sessionId,
    gesture_score: payload.gestureScore,
    gesture_metrics: payload.metrics.map((m) => ({
      name: m.name,
      score: m.score,
      flag: m.flag,
    })),
    duration_seconds: payload.durationSeconds,
  };
  const raw = await fetchJson<{ submission_id: string }>(
    "/interview/submissions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { submissionId: raw.submission_id };
}

// ---- Student-visible submission history + review poll ----

export interface StudentSubmissionSummary {
  submissionId: string;
  questionPrompt: string;
  questionCategory: string;
  gestureScore: number;
  teacherScore: number | null;
  combinedScore: number | null;
  status: "pending" | "reviewed" | "abandoned";
  submittedAt: string;
  reviewedAt: string | null;
}

export interface StudentSubmissionDetail extends StudentSubmissionSummary {
  gestureMetrics: InterviewGestureMetric[];
  durationSeconds: number;
  review: {
    rubric: {
      structure: number;
      clarity: number;
      evidence: number;
      presence: number;
    };
    comment: string;
    teacherScore: number;
    combinedScore: number;
    reviewedAt: string;
  } | null;
}

interface SubmissionWire {
  submission_id: string;
  question_prompt: string;
  question_category: string;
  gesture_score: number;
  gesture_metrics: Array<{ name: string; score: number | null; flag: string }>;
  teacher_score: number | null;
  combined_score: number | null;
  status: "pending" | "reviewed" | "abandoned";
  submitted_at: string;
  reviewed_at: string | null;
  duration_seconds: number;
}

interface ReviewWire {
  rubric: { structure: number; clarity: number; evidence: number; presence: number };
  comment: string;
  teacher_score: number;
  combined_score: number;
  reviewed_at: string;
}

function toSummary(raw: SubmissionWire): StudentSubmissionSummary {
  return {
    submissionId: raw.submission_id,
    questionPrompt: raw.question_prompt,
    questionCategory: raw.question_category,
    gestureScore: Math.round(raw.gesture_score ?? 0),
    teacherScore:
      typeof raw.teacher_score === "number" ? raw.teacher_score : null,
    combinedScore:
      typeof raw.combined_score === "number" ? raw.combined_score : null,
    status: raw.status,
    submittedAt: raw.submitted_at,
    reviewedAt: raw.reviewed_at,
  };
}

export async function fetchMySubmissions(): Promise<StudentSubmissionSummary[]> {
  const data = await fetchJson<{ submissions: SubmissionWire[] }>(
    "/interview/my-submissions",
  );
  return (data.submissions ?? []).map(toSummary);
}

export async function fetchMySubmission(
  submissionId: string,
): Promise<StudentSubmissionDetail> {
  const data = await fetchJson<{ submission: SubmissionWire; review: ReviewWire | null }>(
    `/interview/my-submissions/${encodeURIComponent(submissionId)}`,
  );
  const summary = toSummary(data.submission);
  return {
    ...summary,
    gestureMetrics: (data.submission.gesture_metrics ?? []).map((m) => ({
      name: m.name,
      score: typeof m.score === "number" ? m.score : null,
      flag: m.flag || "ok",
    })),
    durationSeconds: Number(data.submission.duration_seconds ?? 0),
    review: data.review
      ? {
          rubric: data.review.rubric,
          comment: data.review.comment,
          teacherScore: data.review.teacher_score,
          combinedScore: data.review.combined_score,
          reviewedAt: data.review.reviewed_at,
        }
      : null,
  };
}


export interface InterviewAnalysisResult {
  sessionId: string;
  gestureScore: number;
  metrics: InterviewGestureMetric[];
  durationSeconds: number;
  teacherScore: number | null;
  combinedScore: number | null;
  available: boolean;
  message: string | null;
}

interface InterviewAnalysisWire {
  session_id: string;
  gesture_score: number;
  metrics: Array<{ name: string; score: number | null; flag: string }>;
  duration_seconds: number;
  teacher_score: number | null;
  combined_score: number | null;
  available: boolean;
  message: string | null;
}

export async function analyzeInterview(
  video: Blob,
  filename = "interview.webm",
): Promise<InterviewAnalysisResult> {
  // Strip any `;codecs=...` parameter the recorder appended so the
  // backend's allow-list (video/webm, video/mp4, etc.) accepts the upload.
  const bareType = (video.type || "video/webm").split(";")[0] || "video/webm";
  const cleaned = new Blob([video], { type: bareType });

  const formData = new FormData();
  formData.append("video", cleaned, filename);

  const raw = await fetchJson<InterviewAnalysisWire>("/interview/analyze", {
    method: "POST",
    body: formData,
  });

  return {
    sessionId: raw.session_id,
    gestureScore: Math.round(raw.gesture_score ?? 0),
    metrics: (raw.metrics ?? []).map((m) => ({
      name: m.name,
      score: typeof m.score === "number" ? m.score : null,
      flag: m.flag || "ok",
    })),
    durationSeconds: Number(raw.duration_seconds ?? 0),
    teacherScore:
      typeof raw.teacher_score === "number" ? raw.teacher_score : null,
    combinedScore:
      typeof raw.combined_score === "number" ? raw.combined_score : null,
    available: !!raw.available,
    message: raw.message ?? null,
  };
}
