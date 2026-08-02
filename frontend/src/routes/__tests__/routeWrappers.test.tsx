/**
 * Task 3.4 — unit tests for the App route wrappers and `handle*` → path mapping.
 *
 * After the routing refactor, `App` derives the current view from the URL via a
 * `<Routes>` tree, and the thin wrapper components translate URL params/query
 * into the props each view expects. These tests exercise that translation and
 * the navigation handlers:
 *
 *   - `PracticeRoute` maps `?difficulty` / `?i` into `PracticeView` props (Req 2.7).
 *   - `ReportRoute` resolves the report from the in-memory cache (cache-hit,
 *     `degraded=false`), from the last-viewed degraded fallback (`degraded=true`),
 *     and redirects to `/pronunciation` on an unresolvable id (Req 2.5).
 *   - `handle*` navigation handlers push the mapped path (tile click → URL).
 *   - Admin wrappers pass `:submissionId` through and URL-decode `:email` (Req 2.6).
 *
 * Validates: Requirements 2.5, 2.6, 2.7, 3.1
 *
 * Mocking mirrors the sibling route tests: `useAuth` + `api` are mocked for
 * determinism, and heavy view components are stubbed — but here the stubs also
 * surface the props they receive (and expose action buttons) so we can observe
 * the wrapper's translation without loading socket/media/Firebase code.
 * `MainMenuView` is kept real to drive the tile-click navigation.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { fetchSessions, scoreAudio } from "../../api";
import type { AuthUser, ScoreResult, SessionPreview } from "../../types";

/** Render `App` inside a real `BrowserRouter` (App uses router hooks). */
function renderApp() {
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
}

interface MockAuth {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  mode: "firebase" | "bypass";
  signInWithEmail: ReturnType<typeof vi.fn>;
  signInWithGoogle: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  getIdToken: ReturnType<typeof vi.fn>;
  refreshProfile: ReturnType<typeof vi.fn>;
}

let mockAuth: MockAuth;

vi.mock("../../hooks/useAuth", () => ({
  ALLOWED_DOMAIN: "kiet.edu",
  getCurrentIdToken: async () => "test-token",
  useAuth: () => mockAuth,
}));

vi.mock("../../api", () => ({
  fetchSentences: vi.fn().mockResolvedValue([]),
  fetchSessions: vi.fn().mockResolvedValue([]),
  scoreAudio: vi.fn(),
}));

vi.mock("../../components/Header", () => ({
  Header: () => <header data-testid="header" />,
}));

// HomeView stub surfaces the session count (so we can wait for the sessions
// effect to settle) and exposes a button that triggers `onView` (Req 2.5).
vi.mock("../../components/HomeView", () => ({
  HomeView: (props: {
    sessions: SessionPreview[];
    onView: (id: string) => void;
  }) => (
    <div data-testid="home-view">
      <span data-testid="home-session-count">{props.sessions.length}</span>
      <button type="button" onClick={() => props.onView("S-DEG")}>
        view-degraded-session
      </button>
    </div>
  ),
}));

// PracticeView stub surfaces the difficulty/index props the wrapper computes
// from the query, and exposes a submit button that drives the scoring flow.
vi.mock("../../components/PracticeView", () => ({
  PracticeView: (props: {
    difficulty: string;
    sentenceIndex: number;
    onSubmit: (audio: Blob, sentence: unknown) => void;
  }) => (
    <div data-testid="practice-view">
      <span data-testid="practice-difficulty">{props.difficulty}</span>
      <span data-testid="practice-index">{String(props.sentenceIndex)}</span>
      <button
        type="button"
        onClick={() =>
          props.onSubmit(new Blob(["x"]), {
            id: "s1",
            text: "hello",
            difficulty: props.difficulty,
          })
        }
      >
        submit-recording
      </button>
    </div>
  ),
}));

vi.mock("../../components/ProcessingView", () => ({
  ProcessingView: () => <div data-testid="processing-view" />,
}));

// ReportView stub surfaces the resolved `degraded` flag and session id.
vi.mock("../../components/ReportView", () => ({
  ReportView: (props: { report: ScoreResult; degraded: boolean }) => (
    <div data-testid="report-view">
      <span data-testid="report-degraded">{String(props.degraded)}</span>
      <span data-testid="report-session">{props.report.sessionId}</span>
    </div>
  ),
}));

vi.mock("../../components/BattleLobbyView", () => ({
  BattleLobbyView: () => <div data-testid="battle-lobby-view" />,
}));
vi.mock("../../components/BattleRoomView", () => ({
  BattleRoomView: () => <div data-testid="battle-room-view" />,
}));
vi.mock("../../components/BattleResultView", () => ({
  BattleResultView: () => <div data-testid="battle-result-view" />,
}));
vi.mock("../../components/InterviewStudioView", () => ({
  InterviewStudioView: () => <div data-testid="interview-view" />,
}));
vi.mock("../../components/DebateArenaView", () => ({
  DebateArenaView: () => <div data-testid="debate-view" />,
}));
vi.mock("../../components/GDArenaView", () => ({
  GDArenaView: () => <div data-testid="gd-view" />,
}));
vi.mock("../../components/ProfileView", () => ({
  ProfileView: () => <div data-testid="profile-view" />,
}));
vi.mock("../../components/AdminPanelView", () => ({
  AdminPanelView: () => <div data-testid="admin-panel-view" />,
}));

// Admin stubs surface the props the wrappers pass so we can assert the
// param pass-through / URL-decoding (Req 2.6).
vi.mock("../../components/admin/AdminReviewView", () => ({
  AdminReviewView: (props: { submissionId: string }) => (
    <div data-testid="admin-review-view">{props.submissionId}</div>
  ),
}));
vi.mock("../../components/admin/AdminStudentDetailView", () => ({
  AdminStudentDetailView: (props: { email: string }) => (
    <div data-testid="admin-student-view">{props.email}</div>
  ),
}));

const AUTHED_USER: AuthUser = {
  email: "student@kiet.edu",
  displayName: "Test Student",
  loggedInAt: new Date().toISOString(),
  role: "student",
};

const DEGRADED_SUMMARY: SessionPreview = {
  sessionId: "S-DEG",
  createdAt: new Date().toISOString(),
  score: 88,
  durationSeconds: 6,
  sentencePreview: "Hello world",
  available: true,
};

function scoreResultFor(sessionId: string): ScoreResult {
  return {
    sessionId,
    transcript: "hello",
    targetText: "hello",
    score: 91,
    wordResults: [],
    wpm: 120,
    durationSeconds: 4,
    difficulty: "easy",
    available: true,
  };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.mocked(fetchSessions).mockResolvedValue([]);
  vi.mocked(scoreAudio).mockReset();
  mockAuth = {
    user: AUTHED_USER,
    isAuthenticated: true,
    loading: false,
    mode: "bypass",
    signInWithEmail: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    getIdToken: vi.fn().mockResolvedValue("test-token"),
    refreshProfile: vi.fn(),
  };
});

describe("PracticeRoute — query → props (Req 2.7)", () => {
  it("restores difficulty and sentence index from the query string", async () => {
    window.history.replaceState(null, "", "/practice?difficulty=hard&i=2");
    renderApp();

    await screen.findByTestId("practice-view");
    await waitFor(() => {
      expect(screen.getByTestId("practice-difficulty")).toHaveTextContent(
        "hard",
      );
      expect(screen.getByTestId("practice-index")).toHaveTextContent("2");
    });
  });
});

describe("ReportRoute — resolution (Req 2.5)", () => {
  it("resolves a cache-hit as a full (non-degraded) report", async () => {
    vi.mocked(scoreAudio).mockResolvedValue({
      result: scoreResultFor("S-HIT"),
      raw: { analysis_id: "S-HIT" },
    });

    window.history.replaceState(null, "", "/practice?difficulty=easy&i=0");
    const user = userEvent.setup();
    renderApp();

    await screen.findByTestId("practice-view");
    await user.click(screen.getByRole("button", { name: "submit-recording" }));

    // The scoring flow caches the result then routes to /report/S-HIT.
    await screen.findByTestId("report-view");
    expect(screen.getByTestId("report-session")).toHaveTextContent("S-HIT");
    expect(screen.getByTestId("report-degraded")).toHaveTextContent("false");
  });

  it("falls back to a degraded report derived from the session summary", async () => {
    vi.mocked(fetchSessions).mockResolvedValue([DEGRADED_SUMMARY]);

    window.history.replaceState(null, "", "/pronunciation");
    const user = userEvent.setup();
    renderApp();

    // Wait until the sessions effect has populated the list.
    await screen.findByTestId("home-view");
    await waitFor(() =>
      expect(screen.getByTestId("home-session-count")).toHaveTextContent("1"),
    );

    await user.click(
      screen.getByRole("button", { name: "view-degraded-session" }),
    );

    await screen.findByTestId("report-view");
    expect(screen.getByTestId("report-session")).toHaveTextContent("S-DEG");
    expect(screen.getByTestId("report-degraded")).toHaveTextContent("true");
  });

  it("redirects to /pronunciation when the session id is unresolvable", async () => {
    window.history.replaceState(null, "", "/report/UNKNOWN-ID");
    renderApp();

    // No cache entry, no matching summary → <Navigate to="/pronunciation">.
    await screen.findByTestId("home-view");
    expect(screen.queryByTestId("report-view")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/pronunciation");
  });
});

describe("handle* navigation handlers push the mapped path (Req 3.1)", () => {
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ["Open 1v1 battle", "/battle", "battle-lobby-view"],
    ["Open interview studio", "/interview", "interview-view"],
    ["Open debate", "/debate", "debate-view"],
    ["Open group discussion", "/gd", "gd-view"],
    ["Open my profile", "/profile", "profile-view"],
    ["Open pronunciation practice", "/pronunciation", "home-view"],
  ];

  it.each(CASES)(
    "tile %s navigates to %s",
    async (tileLabel, expectedPath, expectedTestId) => {
      const user = userEvent.setup();
      renderApp();

      await user.click(screen.getByRole("button", { name: tileLabel }));

      expect(window.location.pathname).toBe(expectedPath);
      expect(screen.getByTestId(expectedTestId)).toBeInTheDocument();
    },
  );
});

describe("Admin route wrappers (Req 2.6)", () => {
  it("passes :submissionId straight through to AdminReviewView", async () => {
    window.history.replaceState(null, "", "/admin/review/SUB-123");
    renderApp();

    const view = await screen.findByTestId("admin-review-view");
    expect(view).toHaveTextContent("SUB-123");
  });

  it("URL-decodes :email before passing it to AdminStudentDetailView", async () => {
    const email = "first.last@kiet.edu";
    window.history.replaceState(
      null,
      "",
      `/admin/student/${encodeURIComponent(email)}`,
    );
    renderApp();

    const view = await screen.findByTestId("admin-student-view");
    expect(view).toHaveTextContent(email);
  });
});
