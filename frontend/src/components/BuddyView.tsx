import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  GraduationCap,
  Loader2,
  Mic,
  Pause,
  Play,
  Send,
  Square,
  Star,
  UserRound,
  Users2,
} from "lucide-react";
import { Avatar } from "./Avatar";
import { EmptyState } from "./EmptyState";
import { SkeletonList } from "./Skeleton";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { GrowthPanel, LastCycleSummary } from "./buddy/GrowthPanel";
import { MentorGuide } from "./buddy/MentorGuide";
import { Button } from "./console/Console";
import { RaiseConcern } from "./buddy/RaiseConcern";
import { SessionsPanel } from "./buddy/SessionsPanel";
import {
  fetchMessages,
  fetchMyBuddies,
  fetchMyMentoring,
  fetchPairActivity,
  fetchVoiceNoteUrl,
  markConversationRead,
  sendMessage,
  sendVoiceNote,
  type BuddyMessage,
  type ConversationSummary,
  type CycleReport,
  type MentorDashboard,
} from "../buddyApi";

interface BuddyViewProps {
  /** The signed-in user's email — decides which side of the thread is "mine". */
  userEmail: string;
  onBack: () => void;
}

/** Poll interval for an open thread. Async mentorship, not live chat. */
const POLL_MS = 15_000;

/** The inbox only has to notice a new reply, so it refreshes more lazily. */
const INBOX_POLL_MS = 20_000;

/**
 * Runs `onFocus` whenever the tab becomes visible again.
 *
 * Polling alone leaves the view stale for up to a full interval after a student
 * switches back to the app, which is exactly what reads as "nothing shows up
 * until I refresh the page". The callback is held in a ref so callers can pass
 * an inline arrow without re-subscribing on every render.
 */
function useRefreshOnFocus(onFocus: () => void) {
  const latest = useRef(onFocus);
  latest.current = onFocus;

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
}

function displayNameOf(conversation: ConversationSummary): string {
  return conversation.partner_name || conversation.partner_email;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Voice note bubble
// ---------------------------------------------------------------------------

/**
 * Plays a voice note fetched through the authed route.
 *
 * The bytes are pulled on first play and the object URL kept for replays, so
 * scrubbing back and forth doesn't re-download the recording.
 */
function VoiceNoteBubble({ message, mine }: { message: BuddyMessage; mine: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const toggle = useCallback(async () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }

    setError(null);
    try {
      if (!objectUrlRef.current) {
        setLoading(true);
        objectUrlRef.current = await fetchVoiceNoteUrl(message.message_id);
      }
      if (!audioRef.current) {
        const audio = new Audio(objectUrlRef.current);
        audio.onended = () => setPlaying(false);
        audio.onpause = () => setPlaying(false);
        audioRef.current = audio;
      }
      await audioRef.current.play();
      setPlaying(true);
    } catch {
      setError("Could not play this voice note.");
    } finally {
      setLoading(false);
    }
  }, [message.message_id, playing]);

  const Icon = loading ? Loader2 : playing ? Pause : Play;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={loading}
          aria-label={playing ? "Pause voice note" : "Play voice note"}
          className={[
            "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60",
            mine
              ? "bg-white/20 hover:bg-white/30 text-white"
              : "bg-brand-500/20 hover:bg-brand-500/30 text-brand-200",
          ].join(" ")}
        >
          <Icon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <div className="flex items-end gap-[3px] h-6" aria-hidden>
          {/* A static waveform: this is a play affordance, not a real meter. */}
          {[9, 16, 22, 13, 24, 11, 18, 8, 20, 14, 10, 17].map((height, index) => (
            <span
              key={index}
              style={{ height: `${height}px` }}
              className={`w-[3px] rounded-full ${mine ? "bg-white/50" : "bg-brand-300/50"}`}
            />
          ))}
        </div>
        <span className={`text-xs ${mine ? "text-white/70" : "text-zinc-500"}`}>
          Voice note
        </span>
      </div>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------

function ConversationRow({
  conversation,
  onOpen,
}: {
  conversation: ConversationSummary;
  onOpen: () => void;
}) {
  const isMentor = conversation.my_role === "mentor";
  const name = displayNameOf(conversation);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full c-panel p-3 flex items-center gap-3 text-left transition-colors hover:bg-[var(--c-raised)] focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
    >
      <Avatar
        name={name}
        className={`w-11 h-11 text-sm font-semibold text-white ${
          isMentor
            ? "bg-[var(--c-accent-wash)] text-[var(--c-accent-text)] border border-[var(--c-accent-line)]"
            : "bg-[var(--c-raised)] text-[var(--c-muted)] border border-[var(--c-line-strong)]"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-zinc-100 truncate">{name}</span>
          <span
            className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0 ${
              isMentor
                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                : "text-violet-300 bg-violet-500/10 border-violet-500/30"
            }`}
          >
            {isMentor ? "You mentor" : "Your mentor"}
          </span>
          {conversation.status === "ended" && (
            <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-500 shrink-0">
              Ended
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500 truncate mt-0.5">
          {conversation.last_message_preview || "No messages yet"}
        </p>
        {/* A pairing going quiet is what kills an async programme. The nudge is
            null on a healthy pairing on purpose — one on every row would train
            people to ignore all of them. */}
        {conversation.nudge && (
          <p className="text-xs text-amber-300/90 mt-1 truncate">
            {conversation.nudge}
          </p>
        )}
        {conversation.next_session_at && (
          <p className="text-xs text-teal-300/90 mt-1 inline-flex items-center gap-1.5">
            <CalendarClock className="w-3 h-3 shrink-0" />
            Next session {formatTime(conversation.next_session_at)}
          </p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {conversation.last_message_at && (
          <span className="text-xs text-zinc-600">
            {formatTime(conversation.last_message_at)}
          </span>
        )}
        {conversation.unread_count > 0 && (
          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-brand-500 text-white text-xs font-semibold flex items-center justify-center">
            {conversation.unread_count}
          </span>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

/** The cycle's goal and how far through it the pair is. */
function CycleStrip({ report }: { report: CycleReport }) {
  const cycle = report.cycle;
  if (!cycle) return null;

  const start = new Date(cycle.starts_at).getTime();
  const end = new Date(cycle.ends_at).getTime();
  const now = Date.now();
  const span = Math.max(end - start, 1);
  const elapsed = Math.min(Math.max(now - start, 0), span);
  const pct = Math.round((elapsed / span) * 100);

  const day = 24 * 60 * 60 * 1000;
  const totalWeeks = Math.max(Math.round(span / (7 * day)), 1);
  const currentWeek = Math.min(Math.floor(elapsed / (7 * day)) + 1, totalWeeks);
  const daysLeft = Math.max(Math.ceil((end - now) / day), 0);

  return (
    <div className="c-panel px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-xs uppercase tracking-widest text-teal-300">
          Week {currentWeek} of {totalWeeks}
        </span>
        <span className="text-xs text-zinc-500">
          {daysLeft === 0 ? "Final day" : `${daysLeft} days left`}
        </span>
      </div>
      {cycle.goal && (
        <p className="text-sm text-zinc-200 mt-1.5">{cycle.goal}</p>
      )}
      {report.sessions && report.sessions.completed + report.sessions.planned > 0 && (
        <p className="text-xs text-zinc-500 mt-1">
          {report.sessions.completed} of{" "}
          {report.sessions.completed + report.sessions.planned + report.sessions.missed}{" "}
          sessions done
          {report.sessions.missed > 0 && ` · ${report.sessions.missed} missed`}
        </p>
      )}
      <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-[var(--c-accent)]"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Cycle progress"
        />
      </div>
    </div>
  );
}

function ThreadView({
  conversation,
  userEmail,
  onBack,
  onActivity,
}: {
  conversation: ConversationSummary;
  userEmail: string;
  onBack: () => void;
  /** Tells the parent the inbox is stale (new message sent, or read cleared). */
  onActivity: () => void;
}) {
  const [messages, setMessages] = useState<BuddyMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "sessions" | "progress">("chat");
  const [report, setReport] = useState<CycleReport | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const recorder = useAudioRecorder();
  const readOnly = conversation.status !== "active";
  const pairId = conversation.pair_id;

  // Held in a ref so `load` stays stable across the parent's re-renders — the
  // poll below depends on it and must not be torn down every render.
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const data = await fetchMessages(pairId);
        setMessages(data.messages);
        setError(null);

        // Anything the partner sent is on screen the moment it loads, whether
        // that was opening the thread or a poll landing while it sits open.
        // Leaving it unread would badge a conversation the student is reading.
        const unseen = data.messages.some(
          (message) =>
            message.read_at === null &&
            message.sender_email.toLowerCase() !== userEmail.toLowerCase(),
        );
        if (unseen) {
          try {
            const { marked } = await markConversationRead(pairId);
            if (marked > 0) onActivityRef.current();
          } catch {
            // A failed read receipt is not worth interrupting the conversation.
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load messages.");
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [pairId, userEmail],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const refreshCycle = useCallback(async () => {
    try {
      setReport(await fetchPairActivity(pairId));
    } catch {
      // The conversation is the point of this screen; a failed cycle fetch
      // hides the progress tab rather than blocking the thread.
    }
  }, [pairId]);

  // The cycle changes on the scale of weeks, so it is fetched when the thread
  // opens rather than polled — and again whenever a session changes, since
  // that moves the kept-sessions count in the header.
  useEffect(() => {
    void refreshCycle();
  }, [refreshCycle]);

  // Poll for the partner's replies while the thread is open.
  useEffect(() => {
    if (readOnly) return;
    const timer = setInterval(() => void load(false), POLL_MS);
    return () => clearInterval(timer);
  }, [load, readOnly]);

  // Coming back to the tab should not wait out the poll interval.
  useRefreshOnFocus(() => {
    if (!readOnly) void load(false);
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await sendMessage(pairId, text);
      setMessages((current) => [...current, message]);
      setDraft("");
      onActivity();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  }, [draft, onActivity, pairId, sending]);

  const handleVoiceNote = useCallback(async () => {
    if (recorder.isRecording) {
      const blob = await recorder.stop();
      if (!blob || blob.size === 0) return;
      setSending(true);
      setError(null);
      try {
        const message = await sendVoiceNote(pairId, blob);
        setMessages((current) => [...current, message]);
        recorder.reset();
        onActivity();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send that voice note.");
      } finally {
        setSending(false);
      }
      return;
    }
    await recorder.start();
  }, [onActivity, pairId, recorder]);

  const name = displayNameOf(conversation);

  return (
    <div className="console space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="c-btn c-btn-quiet"
          aria-label="Back to your buddies"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <Avatar
          name={name}
          className={`w-9 h-9 text-sm font-semibold text-white ${
            conversation.my_role === "mentor"
              ? "bg-[var(--c-accent-wash)] text-[var(--c-accent-text)] border border-[var(--c-accent-line)]"
              : "bg-[var(--c-raised)] text-[var(--c-muted)] border border-[var(--c-line-strong)]"
          }`}
        />
        <div className="min-w-0">
          <div className="font-semibold text-zinc-100 truncate">{name}</div>
          <div className="text-xs text-zinc-500">
            {conversation.my_role === "mentor"
              ? "You are mentoring them"
              : "They are mentoring you"}
          </div>
        </div>
      </div>

      {report?.cycle && <CycleStrip report={report} />}

      {/* Between cycles there is nothing else on this screen, and the verdict
          on the period that just ended is exactly what the pair came to see.
          While one is running it lives in the progress tab instead. */}
      {report && !report.cycle && report.last_summary && (
        <LastCycleSummary summary={report.last_summary} />
      )}

      {report?.cycle && (
        <div className="flex gap-2" role="tablist" aria-label="Conversation or progress">
          {(
            [
              ["chat", "Conversation"],
              ["sessions", "Sessions"],
              [
                "progress",
                conversation.my_role === "mentor" ? "Their progress" : "Your progress",
              ],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={[
                "px-3.5 py-1.5 rounded-lg text-sm transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60",
                tab === id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {readOnly && (
        <div className="c-panel px-3.5 py-2.5 text-[12.5px] text-[var(--c-muted)]">
          This pairing has ended. You can still read the history.
        </div>
      )}
      {error && (
        <div className="c-panel px-3.5 py-2.5 text-[12.5px] text-[var(--c-neg)] border-[rgba(201,106,92,0.35)]">
          {error}
        </div>
      )}
      {recorder.error && (
        <div className="c-panel px-3.5 py-2.5 text-[12.5px] text-[var(--c-neg)] border-[rgba(201,106,92,0.35)]">
          {recorder.error}
        </div>
      )}

      {tab === "progress" && report ? (
        <div className="space-y-4">
          {report.last_summary && (
            <LastCycleSummary summary={report.last_summary} />
          )}
          <GrowthPanel report={report} />
        </div>
      ) : tab === "sessions" ? (
        <div className="space-y-4">
          <SessionsPanel
            pairId={pairId}
            isMentor={conversation.my_role === "mentor"}
            hasCycle={Boolean(report?.cycle)}
            onChanged={refreshCycle}
          />
          {/* Deliberately understated and deliberately here rather than in the
              header or under the chat: a prominent control invites reporting a
              mentor for one slow week, and under the messages it would read as
              an accusation aimed at whatever was said last. */}
          {!readOnly && (
            <div className="console pt-1">
              <RaiseConcern pairId={pairId} />
            </div>
          )}
        </div>
      ) : (
      <>
      <div className="c-panel p-3.5 max-h-[55vh] overflow-y-auto space-y-2.5">
        {loading ? (
          <SkeletonList count={3} />
        ) : messages.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-8">
            No messages yet. Say hello — a question about a recent attempt is a
            good place to start.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.sender_email.toLowerCase() === userEmail.toLowerCase();
            return (
              <div
                key={message.message_id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={[
                    "max-w-[75%] rounded-2xl px-4 py-2.5",
                    mine
                      ? "bg-brand-600 text-white rounded-br-sm"
                      : "bg-zinc-800/80 text-zinc-100 rounded-bl-sm",
                  ].join(" ")}
                >
                  {message.kind === "voice" ? (
                    <VoiceNoteBubble message={message} mine={mine} />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {message.body}
                    </p>
                  )}
                  <div
                    className={`text-[10px] mt-1 ${mine ? "text-white/60" : "text-zinc-500"}`}
                  >
                    {formatTime(message.sent_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {!readOnly && (
        <div className="c-panel p-2.5 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={
              recorder.isRecording ? "Recording a voice note…" : "Write a message…"
            }
            disabled={recorder.isRecording || sending}
            aria-label="Message"
            className="flex-1 bg-transparent resize-none text-sm text-zinc-100 placeholder:text-zinc-600 px-2 py-2 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleVoiceNote()}
            disabled={sending}
            aria-label={recorder.isRecording ? "Stop and send voice note" : "Record a voice note"}
            className={[
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:opacity-50",
              recorder.isRecording
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse"
                : "bg-zinc-800/80 text-zinc-300 hover:text-zinc-100",
            ].join(" ")}
          >
            {recorder.isRecording ? (
              <Square className="w-4 h-4" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!draft.trim() || sending || recorder.isRecording}
            aria-label="Send message"
            className="w-10 h-10 rounded-xl bg-brand-600 hover:bg-brand-500 text-white flex items-center justify-center shrink-0 transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The mentor's own record
// ---------------------------------------------------------------------------

/**
 * What mentoring has amounted to, shown to the mentor themselves.
 *
 * Mentoring here is unpaid work that until now accrued nothing to the person
 * doing it — every screen was about the mentee. Nothing on this card is stored;
 * it is all derived from sessions and closed cycles.
 */
function MentoringCard({ record }: { record: MentorDashboard }) {
  const stats: Array<[string, string]> = [
    ["Students", String(record.total_mentees)],
    ["Sessions run", String(record.sessions_mentored)],
    [
      "Their rating",
      record.average_rating === null ? "—" : record.average_rating.toFixed(1),
    ],
    ["Cycles finished", String(record.cycles_completed)],
  ];

  return (
    <section className="c-panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-emerald-300" />
        <h2 className="text-sm font-semibold text-zinc-200">
          Your mentoring record
        </h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map(([label, value]) => (
          <div key={label}>
            <span className="block text-2xl font-bold tabular-nums text-zinc-100">
              {value}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">
              {label}
            </span>
          </div>
        ))}
      </div>

      {record.average_rating === null && record.sessions_mentored > 0 && (
        <p className="text-xs text-zinc-500">
          Your students haven't rated a session yet — the rating appears once
          they do.
        </p>
      )}

      {/* Only cycles that closed with a measured verdict count. Claiming an
          unmeasured one would be the easiest lie on this card. */}
      {record.mentees_improved > 0 && (
        <p className="text-sm text-emerald-300 inline-flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 fill-emerald-300" />
          {record.mentees_improved} of your {record.cycles_completed} finished
          cycles ended with the student measurably better.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function BuddyView({ userEmail, onBack }: BuddyViewProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPairId, setOpenPairId] = useState<string | null>(null);
  const [myRecord, setMyRecord] = useState<MentorDashboard | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchMyBuddies();
      setConversations(data.conversations);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your buddies.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The mentor's own record. Fetched once and never polled — it moves on the
  // scale of sessions, and a failure here must not touch the inbox.
  useEffect(() => {
    fetchMyMentoring()
      .then(setMyRecord)
      .catch(() => setMyRecord(null));
  }, []);

  // Keep the inbox live. Without this a reply only appeared after a full page
  // reload: the list fetched once on mount and nothing refreshed it, so both
  // the preview and the unread badge sat stale while the student waited.
  // Paused while a thread is open — that view polls the pair itself, and
  // closing it reloads the list anyway.
  useEffect(() => {
    if (openPairId) return;
    const timer = setInterval(() => void load(), INBOX_POLL_MS);
    return () => clearInterval(timer);
  }, [load, openPairId]);

  useRefreshOnFocus(() => {
    if (!openPairId) void load();
  });

  const open = conversations.find((c) => c.pair_id === openPairId) ?? null;

  if (open) {
    return (
      <ThreadView
        conversation={open}
        userEmail={userEmail}
        onBack={() => {
          setOpenPairId(null);
          void load();
        }}
        onActivity={() => void load()}
      />
    );
  }

  const mentoring = conversations.filter((c) => c.my_role === "mentor");
  const mentored = conversations.filter((c) => c.my_role === "mentee");

  return (
    <div className="console space-y-3">
      {/* A page title set in 36px gradient text over a blurred colour blob is
          decoration; the person opening this already knows what they clicked.
          A quiet identifying bar gives the space back to the conversations. */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--c-line)] pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Button variant="quiet" onClick={onBack}>
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </Button>
          <span className="h-4 w-px bg-[var(--c-line-strong)]" aria-hidden />
          <h1 className="text-[13px] font-semibold text-[var(--c-text)] truncate">
            Speaking Buddy
          </h1>
        </div>
        <p className="hidden sm:block text-[11.5px] text-[var(--c-faint)] truncate">
          Nobody has to be online at the same time
        </p>
      </div>

      {error && (
        <div className="c-panel px-3.5 py-2.5 text-[12.5px] text-[var(--c-neg)] border-[rgba(201,106,92,0.35)]">
          {error}
        </div>
      )}

      {/* On a failed load the banner above already says what went wrong;
          claiming "no buddy yet" as well would be a lie. */}
      {loading ? (
        <SkeletonList count={2} />
      ) : conversations.length === 0 && !error ? (
        <EmptyState
          icon={Users2}
          title="No buddy yet"
          description="Your teacher pairs strong speakers with students who want practice. Keep submitting interviews — that's what the pairing draws on."
        />
      ) : (
        <div className="space-y-6">
          {/* Only for someone who actually mentors — an empty ledger shown to a
              mentee would just be four zeros about a job they don't have.
              Before the first session there is no record to show, and what a
              new mentor needs is instructions, so the guide stands in. */}
          {myRecord?.is_mentor &&
            (myRecord.sessions_mentored > 0 ? (
              <MentoringCard record={myRecord} />
            ) : (
              mentoring.length > 0 && (
                <MentorGuide menteeCount={mentoring.length} />
              )
            ))}
          {mentored.length > 0 && (
            <section className="space-y-2">
              <h2 className="c-label flex items-center gap-1.5">
                <GraduationCap className="w-3.5 h-3.5" />
                Your mentors
              </h2>
              {mentored.map((conversation) => (
                <ConversationRow
                  key={conversation.pair_id}
                  conversation={conversation}
                  onOpen={() => setOpenPairId(conversation.pair_id)}
                />
              ))}
            </section>
          )}
          {mentoring.length > 0 && (
            <section className="space-y-2">
              <h2 className="c-label flex items-center gap-1.5">
                <UserRound className="w-3.5 h-3.5" />
                Students you mentor
              </h2>
              {mentoring.map((conversation) => (
                <ConversationRow
                  key={conversation.pair_id}
                  conversation={conversation}
                  onOpen={() => setOpenPairId(conversation.pair_id)}
                />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
