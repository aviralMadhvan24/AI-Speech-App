/**
 * Unit tests for the student-facing Speaking Buddy view.
 *
 * `buddyApi` is mocked so nothing hits the network, and `useAudioRecorder` is
 * stubbed because jsdom has no MediaRecorder. What's under test is the view's
 * own behaviour: how conversations are grouped, that opening a thread clears
 * the unread badge, and that an ended pairing is read-only.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuddyView } from "../BuddyView";
import type { BuddyMessage, ConversationSummary } from "../../buddyApi";

const fetchMyBuddies = vi.fn();
const fetchMessages = vi.fn();
const sendMessage = vi.fn();
const markConversationRead = vi.fn();
const sendVoiceNote = vi.fn();
const fetchVoiceNoteUrl = vi.fn();
const fetchPairActivity = vi.fn();
const fetchSessions = vi.fn();
const planSession = vi.fn();
const completeSession = vi.fn();
const missSession = vi.fn();
const cancelSession = vi.fn();
const rateSession = vi.fn();
const fetchPracticePrompts = vi.fn();
const fetchMyMentoring = vi.fn();
const fetchMyConcern = vi.fn();
const raiseConcern = vi.fn();

vi.mock("../../buddyApi", () => ({
  rateSession: (...args: unknown[]) => rateSession(...args),
  fetchPracticePrompts: (...args: unknown[]) => fetchPracticePrompts(...args),
  fetchMyMentoring: (...args: unknown[]) => fetchMyMentoring(...args),
  fetchMyConcern: (...args: unknown[]) => fetchMyConcern(...args),
  raiseConcern: (...args: unknown[]) => raiseConcern(...args),
  fetchSessions: (...args: unknown[]) => fetchSessions(...args),
  planSession: (...args: unknown[]) => planSession(...args),
  completeSession: (...args: unknown[]) => completeSession(...args),
  missSession: (...args: unknown[]) => missSession(...args),
  cancelSession: (...args: unknown[]) => cancelSession(...args),
  fetchMyBuddies: (...args: unknown[]) => fetchMyBuddies(...args),
  fetchMessages: (...args: unknown[]) => fetchMessages(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  markConversationRead: (...args: unknown[]) => markConversationRead(...args),
  sendVoiceNote: (...args: unknown[]) => sendVoiceNote(...args),
  fetchVoiceNoteUrl: (...args: unknown[]) => fetchVoiceNoteUrl(...args),
  fetchPairActivity: (...args: unknown[]) => fetchPairActivity(...args),
}));

const recorder = {
  isRecording: false,
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  audioBlob: null,
  stream: null,
  error: null as string | null,
};

vi.mock("../../hooks/useAudioRecorder", () => ({
  useAudioRecorder: () => recorder,
}));

// jsdom implements neither layout nor media playback, so the browser APIs the
// thread legitimately uses have to be stubbed here.
Element.prototype.scrollIntoView = vi.fn();
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
HTMLMediaElement.prototype.pause = vi.fn();
URL.createObjectURL = vi.fn(() => "blob:voice-note");
URL.revokeObjectURL = vi.fn();

const ME = "mentee@kiet.edu";

function conversation(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    pair_id: "pair-1",
    partner_email: "mentor@kiet.edu",
    partner_name: "Ada Mentor",
    my_role: "mentee",
    status: "active",
    unread_count: 0,
    last_message_at: "2026-08-18T10:00:00Z",
    last_message_preview: "how did it go?",
    nudge: null,
    days_quiet: null,
    next_session_at: null,
    sessions_kept: 0,
    ...overrides,
  };
}

function message(overrides: Partial<BuddyMessage> = {}): BuddyMessage {
  return {
    message_id: "m-1",
    pair_id: "pair-1",
    sender_email: "mentor@kiet.edu",
    kind: "text",
    body: "how did it go?",
    audio_id: null,
    audio_path: null,
    duration_seconds: null,
    sent_at: "2026-08-18T10:00:00Z",
    read_at: null,
    ...overrides,
  };
}

function renderView() {
  return render(<BuddyView userEmail={ME} onBack={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  recorder.isRecording = false;
  recorder.error = null;
  fetchMyBuddies.mockResolvedValue({ conversations: [], total: 0 });
  fetchMessages.mockResolvedValue({
    pair_id: "pair-1",
    partner_email: "mentor@kiet.edu",
    partner_name: "Ada Mentor",
    messages: [],
    total: 0,
  });
  markConversationRead.mockResolvedValue({ marked: 0 });
  fetchPairActivity.mockResolvedValue(emptyReport());
  fetchSessions.mockResolvedValue({ sessions: [], total: 0 });
  fetchPracticePrompts.mockResolvedValue({ prompts: [], total: 0 });
  fetchMyMentoring.mockResolvedValue({
    is_mentor: false,
    active_mentees: 0,
    total_mentees: 0,
    sessions_mentored: 0,
    average_rating: null,
    cycles_completed: 0,
    mentees_improved: 0,
  });
  fetchMyConcern.mockResolvedValue({ concern: null });
});

/** A pair between cycles: nothing to track, so nothing to show. */
function emptyReport() {
  return {
    cycle: null,
    axes: [],
    trend: [],
    activity: [],
    counts: {},
    sessions: { planned: 0, completed: 0, missed: 0 },
    enough_for_trend: false,
    last_summary: null,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "s-1",
    pair_id: "pair-1",
    cycle_id: "c-1",
    topic: "Two-minute intro",
    mode: "async_voice",
    scheduled_at: "2026-08-20T15:00:00Z",
    status: "planned",
    completed_at: null,
    duration_minutes: null,
    mentor_notes: "",
    mentee_reflection: "",
    prompt_kind: null,
    prompt_id: null,
    prompt_title: null,
    mentee_rating: null,
    mentee_rating_aspects: [],
    mentee_rating_note: "",
    created_by: "mentor@kiet.edu",
    created_at: "2026-08-18T10:00:00Z",
    ...overrides,
  };
}

function cycle(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    cycle_id: "c-1",
    pair_id: "pair-1",
    mentee_email: ME,
    goal: "Speak for two minutes without filler words",
    focus_area: null,
    // Halfway through a four-week cycle.
    starts_at: new Date(now - 14 * 24 * 3600 * 1000).toISOString(),
    ends_at: new Date(now + 14 * 24 * 3600 * 1000).toISOString(),
    baseline: { content: 60, pronunciation: 74, live_speaking: 55 },
    status: "active",
    created_by: "teacher@kiet.edu",
    created_at: new Date(now - 14 * 24 * 3600 * 1000).toISOString(),
    closed_at: null,
    summary: null,
    ...overrides,
  };
}

describe("BuddyView — conversation list", () => {
  it("tells a student with no pairing what earns them one", async () => {
    renderView();
    expect(await screen.findByText("No buddy yet")).toBeInTheDocument();
  });

  it("separates the people you mentor from the people who mentor you", async () => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [
        conversation({ pair_id: "p-mentee", my_role: "mentee", partner_name: "Ada" }),
        conversation({ pair_id: "p-mentor", my_role: "mentor", partner_name: "Bob" }),
      ],
      total: 2,
    });

    renderView();

    expect(await screen.findByText("Your mentors")).toBeInTheDocument();
    expect(screen.getByText("Students you mentor")).toBeInTheDocument();
    expect(screen.getByText("You mentor")).toBeInTheDocument();
    expect(screen.getByText("Your mentor")).toBeInTheDocument();
  });

  it("shows the unread count and the last message", async () => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ unread_count: 3 })],
      total: 1,
    });

    renderView();

    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.getByText("how did it go?")).toBeInTheDocument();
  });

  it("falls back to the email when the partner has no display name", async () => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ partner_name: null })],
      total: 1,
    });

    renderView();
    expect(await screen.findByText("mentor@kiet.edu")).toBeInTheDocument();
  });

  it("surfaces a failed load instead of showing an empty inbox", async () => {
    fetchMyBuddies.mockRejectedValue(new Error("network is down"));

    renderView();

    expect(await screen.findByText(/network is down/)).toBeInTheDocument();
    expect(screen.queryByText("No buddy yet")).not.toBeInTheDocument();
  });
});

describe("BuddyView — thread", () => {
  beforeEach(() => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ unread_count: 1 })],
      total: 1,
    });
  });

  async function openThread() {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));
    return user;
  }

  it("loads the history and clears the unread badge on open", async () => {
    fetchMessages.mockResolvedValue({
      pair_id: "pair-1",
      partner_email: "mentor@kiet.edu",
      partner_name: "Ada Mentor",
      messages: [message()],
      total: 1,
    });

    await openThread();

    await waitFor(() => expect(fetchMessages).toHaveBeenCalledWith("pair-1"));
    await waitFor(() =>
      expect(markConversationRead).toHaveBeenCalledWith("pair-1"),
    );
  });

  it("explains their role in the pairing", async () => {
    await openThread();
    expect(
      await screen.findByText("They are mentoring you"),
    ).toBeInTheDocument();
  });

  it("sends a typed message and appends it to the thread", async () => {
    sendMessage.mockResolvedValue(
      message({ message_id: "m-new", sender_email: ME, body: "much better, thanks" }),
    );

    const user = await openThread();
    const box = await screen.findByLabelText("Message");
    await user.type(box, "much better, thanks");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith("pair-1", "much better, thanks"),
    );
    expect(await screen.findByText("much better, thanks")).toBeInTheDocument();
  });

  it("refuses to send an empty message", async () => {
    const user = await openThread();
    await screen.findByLabelText("Message");

    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();

    await user.click(send);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("reports a send failure without losing what was typed", async () => {
    sendMessage.mockRejectedValue(new Error("conversation_ended"));

    const user = await openThread();
    const box = await screen.findByLabelText("Message");
    await user.type(box, "hello?");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText(/conversation_ended/)).toBeInTheDocument();
    expect(box).toHaveValue("hello?");
  });

  it("starts recording on the first press of the mic", async () => {
    const user = await openThread();
    await screen.findByLabelText("Message");

    await user.click(screen.getByRole("button", { name: "Record a voice note" }));
    expect(recorder.start).toHaveBeenCalled();
  });

  it("sends the recording when the mic is pressed again", async () => {
    const blob = new Blob(["audio"], { type: "audio/webm" });
    recorder.isRecording = true;
    recorder.stop.mockResolvedValue(blob);
    sendVoiceNote.mockResolvedValue(
      message({ message_id: "m-voice", sender_email: ME, kind: "voice", body: "" }),
    );

    const user = await openThread();
    await user.click(
      await screen.findByRole("button", { name: "Stop and send voice note" }),
    );

    await waitFor(() => expect(sendVoiceNote).toHaveBeenCalledWith("pair-1", blob));
  });

  it("shows a voice note as a playable bubble, not empty text", async () => {
    fetchMessages.mockResolvedValue({
      pair_id: "pair-1",
      partner_email: "mentor@kiet.edu",
      partner_name: "Ada Mentor",
      messages: [message({ kind: "voice", body: "", audio_id: "a-1" })],
      total: 1,
    });

    await openThread();

    expect(
      await screen.findByRole("button", { name: "Play voice note" }),
    ).toBeInTheDocument();
  });

  it("only fetches the audio when the student presses play", async () => {
    fetchMessages.mockResolvedValue({
      pair_id: "pair-1",
      partner_email: "mentor@kiet.edu",
      partner_name: "Ada Mentor",
      messages: [message({ kind: "voice", body: "", audio_id: "a-1" })],
      total: 1,
    });
    fetchVoiceNoteUrl.mockResolvedValue("blob:voice-note");

    const user = await openThread();
    const play = await screen.findByRole("button", { name: "Play voice note" });
    expect(fetchVoiceNoteUrl).not.toHaveBeenCalled();

    await user.click(play);
    await waitFor(() => expect(fetchVoiceNoteUrl).toHaveBeenCalledWith("m-1"));
  });
});

describe("BuddyView — staying up to date", () => {
  const thread = {
    pair_id: "pair-1",
    partner_email: "mentor@kiet.edu",
    partner_name: "Ada Mentor",
  };

  it("refreshes the inbox so a reply appears without a page reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMyBuddies.mockResolvedValue({
        conversations: [conversation({ last_message_preview: "how did it go?" })],
        total: 1,
      });

      renderView();
      expect(await screen.findByText("how did it go?")).toBeInTheDocument();

      fetchMyBuddies.mockResolvedValue({
        conversations: [
          conversation({ last_message_preview: "one more thing", unread_count: 1 }),
        ],
        total: 1,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(screen.getByText("one more thing")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes the inbox when the student comes back to the tab", async () => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation()],
      total: 1,
    });

    renderView();
    await waitFor(() => expect(fetchMyBuddies).toHaveBeenCalledTimes(1));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(fetchMyBuddies).toHaveBeenCalledTimes(2));
  });

  it("clears the badge for a reply that lands while the thread is open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fetchMyBuddies.mockResolvedValue({
        conversations: [conversation()],
        total: 1,
      });
      fetchMessages.mockResolvedValue({ ...thread, messages: [], total: 0 });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderView();
      await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));
      await waitFor(() => expect(fetchMessages).toHaveBeenCalledWith("pair-1"));

      // Nothing unread yet, so no read receipt is owed.
      expect(markConversationRead).not.toHaveBeenCalled();

      fetchMessages.mockResolvedValue({
        ...thread,
        messages: [message({ read_at: null })],
        total: 1,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });

      expect(await screen.findByText("how did it go?")).toBeInTheDocument();
      await waitFor(() =>
        expect(markConversationRead).toHaveBeenCalledWith("pair-1"),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BuddyView — the cycle", () => {
  beforeEach(() => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ my_role: "mentor" })],
      total: 1,
    });
  });

  async function openThread() {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));
    return user;
  }

  it("shows the goal and how far through the cycle the pair is", async () => {
    fetchPairActivity.mockResolvedValue({ ...emptyReport(), cycle: cycle() });

    await openThread();

    expect(await screen.findByText("Week 3 of 4")).toBeInTheDocument();
    expect(
      screen.getByText("Speak for two minutes without filler words"),
    ).toBeInTheDocument();
  });

  it("offers no progress tab when the pair is between cycles", async () => {
    await openThread();

    await waitFor(() => expect(fetchPairActivity).toHaveBeenCalledWith("pair-1"));
    expect(screen.queryByRole("tab", { name: /progress/i })).not.toBeInTheDocument();
  });

  it("shows the mentee's counts and deltas, decline included", async () => {
    fetchPairActivity.mockResolvedValue({
      cycle: cycle(),
      axes: [
        { key: "content", label: "Content", baseline: 60, latest: 70.4, delta: 10.4, sample_size: 3 },
        {
          key: "pronunciation",
          label: "Pronunciation",
          baseline: 74,
          latest: 70.8,
          delta: -3.2,
          sample_size: 2,
        },
      ],
      trend: [],
      activity: [
        { kind: "debate", at: "2026-08-10T12:00:00Z", title: "AI in classrooms", score: 64 },
        { kind: "gd", at: "2026-08-12T12:00:00Z", title: "Remote work", score: 58 },
      ],
      counts: { interview: 0, debate: 1, gd: 1 },
      enough_for_trend: false,
    });

    const user = await openThread();
    await user.click(await screen.findByRole("tab", { name: "Their progress" }));

    expect(await screen.findByText("+10.4")).toBeInTheDocument();
    // A decline is stated as plainly as a gain.
    expect(screen.getByText("−3.2")).toBeInTheDocument();
    expect(screen.getByText("AI in classrooms")).toBeInTheDocument();
    expect(screen.getByText("Remote work")).toBeInTheDocument();
  });

  it("refuses to draw a trend from too few points", async () => {
    fetchPairActivity.mockResolvedValue({
      cycle: cycle(),
      axes: [],
      trend: [
        { at: "2026-08-05", content: 64, pronunciation: null, live_speaking: null },
        { at: "2026-08-20", content: 70, pronunciation: null, live_speaking: null },
      ],
      activity: [
        { kind: "interview", at: "2026-08-05T12:00:00Z", title: "Interview", score: 64 },
      ],
      counts: { interview: 1, debate: 0, gd: 0 },
      enough_for_trend: false,
    });

    const user = await openThread();
    await user.click(await screen.findByRole("tab", { name: "Their progress" }));

    expect(await screen.findByText(/not enough to show a trend/i)).toBeInTheDocument();
  });

  it("says so plainly when the cycle has no scored work yet", async () => {
    fetchPairActivity.mockResolvedValue({ ...emptyReport(), cycle: cycle() });

    const user = await openThread();
    await user.click(await screen.findByRole("tab", { name: "Their progress" }));

    expect(await screen.findByText(/Nothing scored yet in this cycle/i)).toBeInTheDocument();
  });

  it("keeps the conversation reachable from the progress tab", async () => {
    fetchPairActivity.mockResolvedValue({ ...emptyReport(), cycle: cycle() });
    fetchMessages.mockResolvedValue({
      pair_id: "pair-1",
      partner_email: "mentor@kiet.edu",
      partner_name: "Ada Mentor",
      messages: [message({ body: "how did it go?" })],
      total: 1,
    });

    const user = await openThread();
    await user.click(await screen.findByRole("tab", { name: "Their progress" }));
    await user.click(screen.getByRole("tab", { name: "Conversation" }));

    expect(await screen.findByText("how did it go?")).toBeInTheDocument();
  });
});

describe("BuddyView — sessions", () => {
  beforeEach(() => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ my_role: "mentor" })],
      total: 1,
    });
    fetchPairActivity.mockResolvedValue({ ...emptyReport(), cycle: cycle() });
  });

  async function openSessions() {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));
    await user.click(await screen.findByRole("tab", { name: "Sessions" }));
    return user;
  }

  it("explains that sessions need a cycle when none is running", async () => {
    fetchPairActivity.mockResolvedValue(emptyReport());

    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));

    // No cycle means no tabs at all — the thread is the whole screen.
    expect(screen.queryByRole("tab", { name: "Sessions" })).not.toBeInTheDocument();
  });

  it("plans a session with the chosen topic and mode", async () => {
    planSession.mockResolvedValue(session());

    const user = await openSessions();
    await user.type(screen.getByLabelText("Topic"), "Two-minute intro");
    await user.click(screen.getByRole("button", { name: /Plan it/ }));

    await waitFor(() => expect(planSession).toHaveBeenCalled());
    const [pairId, , topic, mode] = planSession.mock.calls[0];
    expect(pairId).toBe("pair-1");
    expect(topic).toBe("Two-minute intro");
    expect(mode).toBe("async_voice");
  });

  it("shows a planned session with its mode and topic", async () => {
    fetchSessions.mockResolvedValue({ sessions: [session()], total: 1 });

    await openSessions();

    expect(await screen.findByText("Two-minute intro")).toBeInTheDocument();
    // Scoped to the row — "Voice notes" is also an option in the plan form.
    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/Voice notes/)).toBeInTheDocument();
    expect(within(row).getByText("planned")).toBeInTheDocument();
  });

  it("records the mentor's note when marking a session done", async () => {
    fetchSessions.mockResolvedValue({ sessions: [session()], total: 1 });
    completeSession.mockResolvedValue(session({ status: "completed" }));

    const user = await openSessions();
    await user.click(await screen.findByRole("button", { name: /Mark done/ }));
    await user.type(screen.getByLabelText("Mentor notes"), "Rushed the opening");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(completeSession).toHaveBeenCalledWith("s-1", "Rushed the opening"),
    );
  });

  it("keeps a missed session rather than hiding it", async () => {
    fetchSessions.mockResolvedValue({
      sessions: [session({ status: "missed" })],
      total: 1,
    });

    await openSessions();

    expect(await screen.findByText("missed")).toBeInTheDocument();
    expect(screen.getByText("Two-minute intro")).toBeInTheDocument();
  });

  it("shows both sides of a completed session without conflating them", async () => {
    fetchSessions.mockResolvedValue({
      sessions: [
        session({
          status: "completed",
          mentor_notes: "Rushed the opening",
          mentee_reflection: "Need to slow down",
        }),
      ],
      total: 1,
    });

    await openSessions();

    expect(await screen.findByText("Rushed the opening")).toBeInTheDocument();
    expect(screen.getByText("Need to slow down")).toBeInTheDocument();
  });

  it("counts kept sessions on the cycle header", async () => {
    fetchPairActivity.mockResolvedValue({
      ...emptyReport(),
      cycle: cycle(),
      sessions: { planned: 2, completed: 3, missed: 1 },
    });

    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));

    expect(await screen.findByText(/3 of 6 sessions done/)).toBeInTheDocument();
    expect(screen.getByText(/1 missed/)).toBeInTheDocument();
  });
});

describe("BuddyView — nudges", () => {
  async function openInbox(overrides: Partial<ConversationSummary>) {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation(overrides)],
      total: 1,
    });
    renderView();
    return screen.findByRole("button", { name: /Ada Mentor/ });
  }

  it("tells a student their pairing has gone quiet", async () => {
    await openInbox({ nudge: "It's been quiet for a week. Pick this back up." });

    expect(
      await screen.findByText("It's been quiet for a week. Pick this back up."),
    ).toBeInTheDocument();
  });

  it("says nothing on a pairing that is running fine", async () => {
    // A nudge on every row would train people to ignore all of them.
    await openInbox({ nudge: null });

    expect(await screen.findByText("how did it go?")).toBeInTheDocument();
    expect(screen.queryByText(/quiet/i)).not.toBeInTheDocument();
  });

  it("answers 'what now?' with the session already in the diary", async () => {
    await openInbox({ next_session_at: "2026-09-02T15:00:00Z" });

    expect(await screen.findByText(/Next session/)).toBeInTheDocument();
  });
});

describe("BuddyView — practice material", () => {
  beforeEach(() => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ my_role: "mentor" })],
      total: 1,
    });
    fetchPairActivity.mockResolvedValue({ ...emptyReport(), cycle: cycle() });
    fetchPracticePrompts.mockResolvedValue({
      prompts: [
        {
          kind: "debate",
          id: "d-1",
          title: "This house would ban homework",
          detail: "Consider the evidence on primary schools.",
        },
        { kind: "gd", id: "g-1", title: "Remote work", detail: "" },
      ],
      total: 2,
    });
  });

  async function openSessions() {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));
    await user.click(await screen.findByRole("tab", { name: "Sessions" }));
    return user;
  }

  it("plans a session against a real catalog item", async () => {
    planSession.mockResolvedValue(session());

    const user = await openSessions();
    await user.selectOptions(
      await screen.findByLabelText("Practice material"),
      "debate",
    );
    await user.selectOptions(await screen.findByLabelText("Practice item"), "d-1");
    await user.click(screen.getByRole("button", { name: /Plan it/ }));

    await waitFor(() =>
      expect(planSession).toHaveBeenCalledWith(
        "pair-1",
        expect.any(String),
        "",
        "async_voice",
        { kind: "debate", id: "d-1" },
      ),
    );
  });

  it("plans a plain session when no material is chosen", async () => {
    // Picking from a catalog must stay optional — a pair who know what they
    // want to work on should not have to.
    planSession.mockResolvedValue(session());

    const user = await openSessions();
    await user.click(await screen.findByRole("button", { name: /Plan it/ }));

    await waitFor(() =>
      expect(planSession).toHaveBeenCalledWith(
        "pair-1",
        expect.any(String),
        "",
        "async_voice",
        null,
      ),
    );
  });

  it("shows the material a planned session is built around", async () => {
    fetchSessions.mockResolvedValue({
      sessions: [
        session({
          prompt_kind: "debate",
          prompt_id: "d-1",
          prompt_title: "This house would ban homework",
        }),
      ],
      total: 1,
    });

    await openSessions();

    // Scoped to the row: "Debate motion" is also one of the picker's options.
    const row = within(await screen.findByRole("listitem"));
    expect(row.getByText("This house would ban homework")).toBeInTheDocument();
    expect(row.getByText("Debate motion")).toBeInTheDocument();
  });
});

describe("BuddyView — rating a session", () => {
  beforeEach(() => {
    fetchPairActivity.mockResolvedValue({ ...emptyReport(), cycle: cycle() });
  });

  async function openSessionsAs(role: "mentor" | "mentee") {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ my_role: role })],
      total: 1,
    });
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));
    await user.click(await screen.findByRole("tab", { name: "Sessions" }));
    return user;
  }

  it("lets the mentee rate a session they received", async () => {
    fetchSessions.mockResolvedValue({
      sessions: [session({ status: "completed", mentee_reflection: "useful" })],
      total: 1,
    });
    rateSession.mockResolvedValue(session({ status: "completed", mentee_rating: 4 }));

    const user = await openSessionsAs("mentee");
    await user.click(await screen.findByRole("button", { name: "Rate 4 out of 5" }));
    await user.click(await screen.findByRole("button", { name: "Send" }));

    await waitFor(() => expect(rateSession).toHaveBeenCalledWith("s-1", 4, [], ""));
  });

  it("asks what worked for a high rating and what went wrong for a low one", async () => {
    // Showing all eight reasons at once asks the mentee to do the sorting,
    // and they skip it. The question follows the answer.
    fetchSessions.mockResolvedValue({
      sessions: [session({ status: "completed" })],
      total: 1,
    });
    rateSession.mockResolvedValue(session({ status: "completed", mentee_rating: 2 }));

    const user = await openSessionsAs("mentee");

    await user.click(await screen.findByRole("button", { name: "Rate 5 out of 5" }));
    expect(await screen.findByText("What worked?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Came prepared" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Feedback was vague" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rate 2 out of 5" }));
    expect(await screen.findByText("What went wrong?")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Feedback was vague" }),
    ).toBeInTheDocument();
  });

  it("sends the reasons along with the number", async () => {
    fetchSessions.mockResolvedValue({
      sessions: [session({ status: "completed" })],
      total: 1,
    });
    rateSession.mockResolvedValue(session({ status: "completed", mentee_rating: 2 }));

    const user = await openSessionsAs("mentee");
    await user.click(await screen.findByRole("button", { name: "Rate 2 out of 5" }));
    await user.click(await screen.findByRole("button", { name: "Feedback was vague" }));
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(rateSession).toHaveBeenCalledWith("s-1", 2, ["vague"], ""),
    );
  });

  it("tells the mentee their mentor will read it", async () => {
    // Pretending a 1:1 rating were anonymous is a lie the reader can disprove.
    // The private channel is the concern link, and this says so.
    fetchSessions.mockResolvedValue({
      sessions: [session({ status: "completed" })],
      total: 1,
    });

    const user = await openSessionsAs("mentee");
    await user.click(await screen.findByRole("button", { name: "Rate 3 out of 5" }));

    expect(await screen.findByText(/Your mentor sees this/)).toBeInTheDocument();
  });

  it("shows the mentor the reasons, not just the number", async () => {
    // The whole point: a bare 2/5 tells them to feel bad and nothing more.
    fetchSessions.mockResolvedValue({
      sessions: [
        session({
          status: "completed",
          mentee_rating: 2,
          mentee_rating_aspects: ["vague"],
          mentee_rating_note: "be more specific",
        }),
      ],
      total: 1,
    });

    await openSessionsAs("mentor");

    expect(await screen.findByText("Feedback was vague")).toBeInTheDocument();
    expect(screen.getByText(/be more specific/)).toBeInTheDocument();
  });

  it("never offers the mentor a way to rate their own session", async () => {
    // A self-rating would make the only mentoring-quality signal worthless.
    fetchSessions.mockResolvedValue({
      sessions: [session({ status: "completed", mentor_notes: "went well" })],
      total: 1,
    });

    await openSessionsAs("mentor");

    await screen.findByText("went well");
    expect(
      screen.queryByRole("button", { name: /Rate \d out of 5/ }),
    ).not.toBeInTheDocument();
  });

  it("shows a mentor the rating their mentee already gave", async () => {
    fetchSessions.mockResolvedValue({
      sessions: [session({ status: "completed", mentee_rating: 5 })],
      total: 1,
    });

    await openSessionsAs("mentor");

    expect(await screen.findByText("Your mentee rated this")).toBeInTheDocument();
  });

  it("offers nothing to rate on a session that has not happened", async () => {
    fetchSessions.mockResolvedValue({ sessions: [session()], total: 1 });

    await openSessionsAs("mentee");

    await screen.findByText("Two-minute intro");
    expect(screen.queryByText("How was it?")).not.toBeInTheDocument();
  });
});

describe("BuddyView — the closing verdict", () => {
  beforeEach(() => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation()],
      total: 1,
    });
  });

  function summary(overrides: Record<string, unknown> = {}) {
    return {
      axes: [
        {
          key: "content",
          label: "Content",
          baseline: 60,
          final: 75,
          delta: 15,
          sample_size: 3,
        },
      ],
      sessions_completed: 4,
      sessions_missed: 1,
      sessions_planned: 0,
      activity_count: 6,
      goal: "Speak for two minutes without filler words",
      verdict: "improved",
      generated_at: "2026-09-01T00:00:00Z",
      ...overrides,
    };
  }

  it("tells the pair how the cycle they just finished went", async () => {
    fetchPairActivity.mockResolvedValue({
      ...emptyReport(),
      last_summary: summary(),
    });

    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));

    expect(await screen.findByText("You improved")).toBeInTheDocument();
    expect(screen.getByText("+15.0")).toBeInTheDocument();
    expect(screen.getByText(/4 of 5 sessions kept/)).toBeInTheDocument();
  });

  it("admits an unmeasured cycle rather than calling it a flat result", async () => {
    fetchPairActivity.mockResolvedValue({
      ...emptyReport(),
      last_summary: summary({ verdict: "not_enough_evidence", axes: [] }),
    });

    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));

    expect(await screen.findByText("Not enough was measured")).toBeInTheDocument();
  });
});

describe("BuddyView — the mentor's own record", () => {
  it("shows a mentor what their mentoring has added up to", async () => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ my_role: "mentor" })],
      total: 1,
    });
    fetchMyMentoring.mockResolvedValue({
      is_mentor: true,
      active_mentees: 2,
      total_mentees: 3,
      sessions_mentored: 9,
      average_rating: 4.5,
      cycles_completed: 2,
      mentees_improved: 1,
    });

    renderView();

    expect(await screen.findByText("Your mentoring record")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("4.5")).toBeInTheDocument();
  });

  it("tells a brand-new mentor how to start instead of showing four zeros", async () => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ my_role: "mentor" })],
      total: 1,
    });
    fetchMyMentoring.mockResolvedValue({
      is_mentor: true,
      active_mentees: 1,
      total_mentees: 1,
      sessions_mentored: 0,
      average_rating: null,
      cycles_completed: 0,
      mentees_improved: 0,
    });

    renderView();

    expect(await screen.findByText("You're a mentor now")).toBeInTheDocument();
    expect(screen.getByText("Send the first voice note")).toBeInTheDocument();
    expect(screen.queryByText("Your mentoring record")).not.toBeInTheDocument();
  });

  it("shows a mentee no ledger for a job they do not have", async () => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation()],
      total: 1,
    });

    renderView();

    await screen.findByText("Your mentors");
    expect(screen.queryByText("Your mentoring record")).not.toBeInTheDocument();
  });
});

describe("BuddyView — ended pairings", () => {
  beforeEach(() => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation({ status: "ended" })],
      total: 1,
    });
  });

  it("marks an ended pairing in the list", async () => {
    renderView();
    expect(await screen.findByText("Ended")).toBeInTheDocument();
  });

  it("keeps the history readable but removes the composer", async () => {
    fetchMessages.mockResolvedValue({
      pair_id: "pair-1",
      partner_email: "mentor@kiet.edu",
      partner_name: "Ada Mentor",
      messages: [message({ body: "good luck!" })],
      total: 1,
    });

    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));

    expect(await screen.findByText("good luck!")).toBeInTheDocument();
    expect(
      screen.getByText(/This pairing has ended/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).not.toBeInTheDocument();
  });
});

describe("BuddyView — own vs partner messages", () => {
  it("renders both sides of the conversation", async () => {
    fetchMyBuddies.mockResolvedValue({
      conversations: [conversation()],
      total: 1,
    });
    fetchMessages.mockResolvedValue({
      pair_id: "pair-1",
      partner_email: "mentor@kiet.edu",
      partner_name: "Ada Mentor",
      messages: [
        message({ message_id: "m-1", sender_email: "MENTOR@kiet.edu", body: "theirs" }),
        message({ message_id: "m-2", sender_email: ME.toUpperCase(), body: "mine" }),
      ],
      total: 2,
    });

    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: /Ada Mentor/ }));

    // The sender comparison is case-insensitive on both sides, so neither
    // bubble is dropped or attributed to the wrong person. "Mine" is rendered
    // as the accented, right-aligned bubble; the partner's is not.
    const mine = (await screen.findByText("mine")).closest("div");
    const theirs = screen.getByText("theirs").closest("div");

    expect(mine).toHaveClass("bg-brand-600");
    expect(theirs).not.toHaveClass("bg-brand-600");
  });
});
