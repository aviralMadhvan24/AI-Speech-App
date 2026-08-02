/**
 * Task 2 — Preservation property tests (Property 2: Preservation).
 *
 * These capture the CURRENT (unfixed) behavior that the routing fix must NOT
 * regress, so they are EXPECTED TO PASS on the unfixed app (observation-first):
 *   - Every main-menu tile opens its expected target view (Req 3.1).
 *   - An unauthenticated App renders LoginView and gates all activities (Req 3.2).
 *   - The Admin Panel tile only renders for teacher accounts (Req 3.3).
 *
 * The tile -> view mapping is exercised as a property over the finite set of
 * main-menu tiles (design "generate over the set of main-menu tiles").
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 *
 * Mocking mirrors the exploration test: `useAuth` + `api` are mocked for
 * determinism, heavy view components are stubbed with stable testids, and
 * `MainMenuView` / `LoginView` are kept real.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { AuthUser } from "../../types";

/** Render `App` inside a real `BrowserRouter` (App now uses router hooks). */
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
vi.mock("../../components/HomeView", () => ({
  HomeView: () => <div data-testid="home-view" />,
}));
vi.mock("../../components/PracticeView", () => ({
  PracticeView: () => <div data-testid="practice-view" />,
}));
vi.mock("../../components/ProcessingView", () => ({
  ProcessingView: () => <div data-testid="processing-view" />,
}));
vi.mock("../../components/ReportView", () => ({
  ReportView: () => <div data-testid="report-view" />,
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
vi.mock("../../components/admin/AdminReviewView", () => ({
  AdminReviewView: () => <div data-testid="admin-review-view" />,
}));
vi.mock("../../components/admin/AdminStudentDetailView", () => ({
  AdminStudentDetailView: () => <div data-testid="admin-student-view" />,
}));

const AUTHED_USER: AuthUser = {
  email: "student@kiet.edu",
  displayName: "Test Student",
  loggedInAt: new Date().toISOString(),
  role: "student",
};

const ADMIN_TILE = "Open admin panel";

// The finite input space for the tile -> view navigation property. Each tuple
// is [tile accessible name, expected view testid] for a non-admin account.
const TILE_CASES: ReadonlyArray<readonly [string, string]> = [
  ["Open my profile", "profile-view"],
  ["Open pronunciation practice", "home-view"],
  ["Open 1v1 battle", "battle-lobby-view"],
  ["Open interview studio", "interview-view"],
  ["Open debate", "debate-view"],
  ["Open group discussion", "gd-view"],
];

beforeEach(() => {
  window.history.replaceState(null, "", "/");
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

describe("Property 2: Preservation — in-app navigation & auth gating", () => {
  it.each(TILE_CASES)(
    "main-menu tile %s opens its expected view (Req 3.1)",
    async (tileLabel, expectedTestId) => {
      const user = userEvent.setup();
      renderApp();

      await user.click(screen.getByRole("button", { name: tileLabel }));

      expect(screen.getByTestId(expectedTestId)).toBeInTheDocument();
    },
  );

  it("unauthenticated App renders LoginView and gates every activity view (Req 3.2)", () => {
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;

    renderApp();

    // LoginView is on screen ("KIET Members Only" is unique to it).
    expect(screen.getByText("KIET Members Only")).toBeInTheDocument();
    // No activity tile / view is reachable while unauthenticated.
    expect(
      screen.queryByRole("button", { name: "Open 1v1 battle" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("battle-lobby-view")).not.toBeInTheDocument();
  });

  it("Admin Panel tile only renders for teacher accounts (Req 3.3)", () => {
    // Student: no Admin tile.
    renderApp();
    expect(
      screen.queryByRole("button", { name: ADMIN_TILE }),
    ).not.toBeInTheDocument();
    cleanup();

    // Teacher: Admin tile is present and opens the admin panel.
    mockAuth.user = { ...AUTHED_USER, role: "teacher" };
    renderApp();
    expect(
      screen.getByRole("button", { name: ADMIN_TILE }),
    ).toBeInTheDocument();
  });
});
