/**
 * Unit tests for the student-facing Speaking Buddy view.
 *
 * `buddyApi` is mocked so nothing hits the network, and `useAudioRecorder` is
 * stubbed because jsdom has no MediaRecorder. What's under test is the view's
 * own behaviour: how conversations are grouped, that opening a thread clears
 * the unread badge, and that an ended pairing is read-only.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
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

vi.mock("../../buddyApi", () => ({
  fetchMyBuddies: (...args: unknown[]) => fetchMyBuddies(...args),
  fetchMessages: (...args: unknown[]) => fetchMessages(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  markConversationRead: (...args: unknown[]) => markConversationRead(...args),
  sendVoiceNote: (...args: unknown[]) => sendVoiceNote(...args),
  fetchVoiceNoteUrl: (...args: unknown[]) => fetchVoiceNoteUrl(...args),
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
});

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
