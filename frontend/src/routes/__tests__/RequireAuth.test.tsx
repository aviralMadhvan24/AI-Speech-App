/**
 * Task 3.3 — unit tests for the RequireAuth route guard.
 *
 * RequireAuth reproduces App's three auth branches for the routed app:
 *   - while `loading`: render the "Restoring your session…" splash;
 *   - when `!user`: render LoginView in place WITHOUT changing the URL;
 *   - when `user`: render its children.
 *
 * Validates: Requirements 2.9, 3.2
 *
 * `useAuth` is mocked (as in the sibling route tests) for determinism — no
 * Firebase. LoginView is kept real so we assert the actual login gate renders.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "../RequireAuth";
import type { AuthUser } from "../../types";

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

const AUTHED_USER: AuthUser = {
  email: "student@kiet.edu",
  displayName: "Test Student",
  loggedInAt: new Date().toISOString(),
  role: "student",
};

const PROTECTED_TEXT = "protected content";
const PROTECTED_TESTID = "protected-child";

function renderGuard() {
  return render(
    <RequireAuth>
      <div data-testid={PROTECTED_TESTID}>{PROTECTED_TEXT}</div>
    </RequireAuth>,
  );
}

beforeEach(() => {
  // Reset URL between tests so we can assert the guard never changes it.
  window.history.replaceState({}, "", "/battle/ABC234");
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

describe("RequireAuth guard", () => {
  it("renders the restoring-session splash while loading (children hidden)", () => {
    mockAuth.loading = true;
    // Even with no user yet, loading takes precedence over the login branch.
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;

    renderGuard();

    expect(screen.getByText("Restoring your session…")).toBeInTheDocument();
    expect(screen.queryByTestId(PROTECTED_TESTID)).not.toBeInTheDocument();
    expect(screen.queryByText("KIET Members Only")).not.toBeInTheDocument();
  });

  it("renders LoginView when unauthenticated and leaves the URL unchanged (Req 2.9, 3.2)", () => {
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;

    renderGuard();

    // LoginView is on screen ("KIET Members Only" is unique to it).
    expect(screen.getByText("KIET Members Only")).toBeInTheDocument();
    // Children are gated.
    expect(screen.queryByTestId(PROTECTED_TESTID)).not.toBeInTheDocument();
    // The intended route is preserved in the address bar (gate-in-place).
    expect(window.location.pathname).toBe("/battle/ABC234");
  });

  it("renders children when authenticated", () => {
    renderGuard();

    expect(screen.getByTestId(PROTECTED_TESTID)).toBeInTheDocument();
    expect(screen.getByText(PROTECTED_TEXT)).toBeInTheDocument();
    // Neither gate branch is shown.
    expect(
      screen.queryByText("Restoring your session…"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("KIET Members Only")).not.toBeInTheDocument();
  });
});
