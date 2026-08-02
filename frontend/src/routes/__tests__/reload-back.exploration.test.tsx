/**
 * Task 1 — Bug condition exploration test (Property 1: Bug Condition).
 *
 * These tests encode the EXPECTED POST-FIX behavior for Req 2.1 (a reload must
 * keep the user on the same view) and Req 2.8 (browser Back must return to the
 * previous in-app view). On the current, unfixed app — where navigation lives
 * only in `App`'s in-memory `view` state and no history entries are pushed —
 * they are EXPECTED TO FAIL. That failure is the whole point: it reproduces the
 * bug and surfaces the counterexamples described in the design.
 *
 * The bug is deterministic, so instead of random generation we scope the
 * property to concrete failing cases (design "Scoped PBT Approach"):
 *   (a) drive App into a non-default view, then remount App fresh (a reload)
 *       and assert we are still on that view.
 *   (b) after an in-app navigation, simulate browser Back and assert we stay
 *       in-app on the previous view.
 *
 * Validates: Requirements 2.1, 2.8
 *
 * What is mocked and why (this app uses Firebase/sockets/media that don't exist
 * in jsdom, so we isolate the navigation state machine in App):
 *   - `../../hooks/useAuth`  -> deterministic authed user (no Firebase).
 *   - `../../api`            -> no network on the initial data-loading effects.
 *   - heavy view components  -> tiny stubs with a stable testid, so we can
 *                               observe WHICH view App renders without loading
 *                               socket/media/Firebase code. `MainMenuView` and
 *                               `LoginView` are kept REAL (we drive the tiles /
 *                               assert the login gate).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import type { AuthUser } from "../../types";

/**
 * Render `App` inside a real `BrowserRouter`. `BrowserRouter` reads
 * `window.history`/`window.location`, which persist across unmount/remount in
 * jsdom — so a "reload" (unmount + fresh render) re-resolves the SAME URL and
 * therefore the same view, which is exactly the post-fix behavior we assert.
 */
function renderApp() {
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  );
}

// --- Mutable auth state the mocked hook returns (set per test) -------------
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

// Heavy view + chrome stubs — keep MainMenuView and LoginView real.
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

const BATTLE_TILE = "Open 1v1 battle";

beforeEach(() => {
  // Reset the URL to the default landing route before each test so history
  // state does not leak between cases.
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

describe("Property 1: Bug Condition — reload / Back away from main-menu", () => {
  it("reload (fresh remount) keeps the user on their current view (Req 2.1)", async () => {
    const user = userEvent.setup();

    const { unmount } = renderApp();
    // Start on the main menu, then navigate into a non-default view. The tile
    // click pushes `/battle` onto the browser history.
    await user.click(screen.getByRole("button", { name: BATTLE_TILE }));
    expect(screen.getByTestId("battle-lobby-view")).toBeInTheDocument();

    // Simulate a browser reload: tear down and re-create the app from scratch.
    // The URL (`/battle`) persists, so a fresh BrowserRouter re-resolves it.
    unmount();
    renderApp();

    // Post-fix: still on battle-lobby (the route re-resolved from the URL).
    expect(screen.getByTestId("battle-lobby-view")).toBeInTheDocument();
  });

  it("browser Back returns to the previous in-app view instead of leaving the app (Req 2.8)", async () => {
    const user = userEvent.setup();

    renderApp();
    await user.click(screen.getByRole("button", { name: BATTLE_TILE }));
    expect(screen.getByTestId("battle-lobby-view")).toBeInTheDocument();

    // Simulate the browser Back button; react-router reacts to `popstate`.
    window.history.back();

    // Post-fix: Back pops to the previous in-app view (main-menu) — the app
    // stays mounted and re-renders the tiles.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: BATTLE_TILE }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("battle-lobby-view")).not.toBeInTheDocument();
  });
});
