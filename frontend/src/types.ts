// Public-facing domain types consumed by all components.
// The wire formats from the backend live entirely inside api.ts.

export interface AuthUser {
  email: string;
  displayName: string;
  loggedInAt: string;
}


export type Difficulty = "easy" | "medium" | "hard";

export interface Sentence {
  id: string;
  text: string;
  difficulty: Difficulty;
  focusWord?: string;
  hint?: string;
}

export interface WordResult {
  /** The expected/target word. */
  word: string;
  /** What the model heard, when it differs from the expected word. */
  heard?: string;
  /** True when score >= 70 (or backend has no scoring and we fall back to transcript match). */
  correct: boolean;
  /** Backend-provided per-word score, 0..100. */
  score?: number;
  /** Optional feedback string for the word. */
  feedback?: string;
}

export interface ScoreResult {
  sessionId: string;
  transcript: string;
  targetText: string;
  /** 0..100 overall pronunciation score. */
  score: number;
  wordResults: WordResult[];
  wpm: number;
  durationSeconds: number;
  difficulty: Difficulty;
  clarityScore?: number;
  provider?: string;
  /** True when the backend produced a real pronunciation analysis. */
  available: boolean;
}

export interface SessionPreview {
  sessionId: string;
  createdAt: string;
  score: number | null;
  durationSeconds: number | null;
  sentencePreview: string;
  available: boolean;
}

// --- Wire types (kept here only because App.tsx caches the raw response) ---

export interface AnalyzeRaw {
  analysis_id: string;
  audio?: {
    duration_seconds?: number | null;
  };
  transcription?: {
    text?: string;
    normalized_text?: string;
    language?: string;
  };
  pronunciation?: {
    available?: boolean;
    provider?: string | null;
    overall_score?: number | null;
    words?: Array<{
      word: string;
      score?: number | null;
      feedback?: string | null;
      expected_phonemes?: string[];
      observed_phonemes?: string[];
      errors?: unknown[];
    }>;
    message?: string | null;
  };
  fluency?: {
    words_per_minute?: number | null;
    clarity_score?: number | null;
    speech_duration_seconds?: number | null;
    total_duration_seconds?: number | null;
  };
  debug?: {
    expected_text?: string;
    transcript_match_score?: number | null;
    transcript_mistakes?: Array<{
      expected_word: string;
      heard_word?: string | null;
      feedback?: string | null;
    }>;
  };
  [key: string]: unknown;
}
