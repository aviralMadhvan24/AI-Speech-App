// TypeScript types mirroring the backend Pydantic schemas in
// `backend/schemas.py`. Keep these in sync if the backend evolves.

export type SessionState = 'queued' | 'processing' | 'completed' | 'failed';

export type MetricFlag =
  | 'ok'
  | 'low_confidence'
  | 'detection_failed'
  | 'no_frames'
  | 'student_absent';

export interface MetricResult {
  name: string;
  score: number | null;
  flag: MetricFlag;
  details: Record<string, unknown>;
}

export interface Suggestion {
  metric: string;
  score: number | null;
  band: 'low' | 'mid' | 'high' | 'unavailable';
  text: string;
}

export interface OverallScore {
  value: number;
  session_flag: 'low_confidence' | null;
  applied_weights: Record<string, number>;
}

export interface Report {
  session_id: string;
  created_at: string;
  duration_seconds: number;
  overall: OverallScore;
  metrics: MetricResult[];
  suggestions: Suggestion[];
}

export interface SessionMetadata {
  session_id: string;
  created_at: string;
  duration_seconds: number;
  state: SessionState;
  error: string | null;
  overall_score: number | null;
}

export interface PrecheckResult {
  pose_ok: boolean;
  face_ok: boolean;
}

export type ViewName = 'home' | 'recording' | 'processing' | 'report';
