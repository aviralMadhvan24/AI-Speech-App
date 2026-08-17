// Typed wrappers for the /admin/* endpoints. All calls go through fetch with
// the Firebase ID token attached via the same `authedHeaders` pattern used in
// api.ts. The backend enforces teacher-only access — non-teachers get 403.

import { getCurrentIdToken } from "./hooks/useAuth";

// ---------------------------------------------------------------------------
// Domain types — mirror the JSON shapes the backend serializes.
// ---------------------------------------------------------------------------

export type SubmissionStatus = "pending" | "reviewed" | "abandoned";

export interface AdminGestureMetric {
  name: string;
  score: number | null;
  flag: string;
}

export interface AdminPronunciationResult {
  available: boolean;
  score: number | null;
  provider: string | null;
  feedback: string;
  issue_count: number;
}

export interface AdminContentResult {
  total: number;
  feedback: string;
  transcript: string;
  pronunciation: AdminPronunciationResult;
}

export interface AdminSubmission {
  submission_id: string;
  student_email: string;
  student_uid: string;
  student_name: string | null;
  question_id: string;
  question_prompt: string;
  question_category: string;
  gesture_session_id: string | null;
  gesture_score: number;
  gesture_metrics: AdminGestureMetric[];
  content_result: AdminContentResult | null;
  pronunciation_state: "not_requested" | "pending" | "completed" | "failed";
  duration_seconds: number;
  status: SubmissionStatus;
  submitted_at: string;
  reviewed_at: string | null;
  teacher_score: number | null;
  combined_score: number | null;
}

export interface AdminReviewRubric {
  structure: number;
  clarity: number;
  evidence: number;
  presence: number;
}

export interface AdminReview {
  review_id: string;
  submission_id: string;
  reviewer_email: string;
  reviewer_name: string | null;
  rubric: AdminReviewRubric;
  comment: string;
  teacher_score: number;
  combined_score: number;
  reviewed_at: string;
}

export interface AdminSubmissionDetail {
  submission: AdminSubmission;
  review: AdminReview | null;
}

export interface AdminPendingResponse {
  submissions: AdminSubmission[];
  total: number;
}

export interface AdminMe {
  email: string;
  display_name: string | null;
  role: string;
}

export interface AdminStudentSummary {
  email: string;
  display_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  submissions_total: number;
  submissions_reviewed: number;
  avg_combined_score: number | null;
}

export interface AdminStudentsResponse {
  students: AdminStudentSummary[];
  total: number;
}

export interface AdminStudentDetail {
  email: string;
  display_name: string | null;
  role: string;
  first_seen_at: string;
  last_seen_at: string;
  submissions: AdminSubmission[];
}

export interface AdminAnalytics {
  student_count: number;
  teacher_count: number;
  submissions_total: number;
  submissions_pending: number;
  submissions_reviewed: number;
  avg_gesture_score: number | null;
  avg_teacher_score: number | null;
  avg_combined_score: number | null;
}

export interface AdminLeaderboardEntry {
  email: string;
  display_name: string | null;
  attempts: number;
  best_score: number;
  avg_score: number;
}

export interface AdminLeaderboardResponse {
  entries: AdminLeaderboardEntry[];
  total: number;
}

export interface AdminReviewPayload {
  structure: number;
  clarity: number;
  evidence: number;
  presence: number;
  comment: string;
}

// ---------------------------------------------------------------------------
// Fetch helpers — kept private to this module. Same shape as api.ts.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API — typed wrappers, one per backend route.
// ---------------------------------------------------------------------------

export function fetchAdminMe(): Promise<AdminMe> {
  return fetchJson<AdminMe>("/admin/me");
}

export function fetchPendingSubmissions(): Promise<AdminPendingResponse> {
  return fetchJson<AdminPendingResponse>("/admin/submissions/pending");
}

export function fetchSubmissionDetail(
  submissionId: string,
): Promise<AdminSubmissionDetail> {
  return fetchJson<AdminSubmissionDetail>(
    `/admin/submissions/${encodeURIComponent(submissionId)}`,
  );
}

/**
 * Streams the recorded interview video. We can't put an Authorization header
 * on a raw `<video src>`, so we fetch the bytes once, wrap them in a blob URL,
 * and hand that to the video element. Callers are responsible for revoking the
 * URL when the view unmounts.
 */
export async function fetchSubmissionVideoBlob(
  submissionId: string,
): Promise<string> {
  const token = await getCurrentIdToken();
  const response = await fetch(
    `/admin/submissions/${encodeURIComponent(submissionId)}/video`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Video unavailable (${response.status} ${response.statusText})`,
    );
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function submitReview(
  submissionId: string,
  payload: AdminReviewPayload,
): Promise<AdminReview> {
  return fetchJson<AdminReview>(
    `/admin/submissions/${encodeURIComponent(submissionId)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export function fetchAllStudents(): Promise<AdminStudentsResponse> {
  return fetchJson<AdminStudentsResponse>("/admin/students");
}

export function fetchStudentDetail(email: string): Promise<AdminStudentDetail> {
  return fetchJson<AdminStudentDetail>(
    `/admin/students/${encodeURIComponent(email)}`,
  );
}

export function fetchAnalytics(): Promise<AdminAnalytics> {
  return fetchJson<AdminAnalytics>("/admin/analytics");
}

export function fetchLeaderboard(
  limit = 10,
): Promise<AdminLeaderboardResponse> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  return fetchJson<AdminLeaderboardResponse>(
    `/admin/leaderboard?limit=${safeLimit}`,
  );
}
