/**
 * Sessions: the countable unit of practice inside a cycle.
 *
 * Either side may plan one, and both may close the same session out — the
 * mentor's observation and the mentee's reflection are separate notes, so
 * whoever writes second does not overwrite the first.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, Loader2, Star, X } from "lucide-react";
import {
  cancelSession,
  completeSession,
  fetchPracticePrompts,
  fetchSessions,
  missSession,
  planSession,
  rateSession,
  type BuddySession,
  type PracticePrompt,
  type PromptKind,
  type SessionMode,
} from "../../buddyApi";

const MODE_LABEL: Record<SessionMode, string> = {
  async_voice: "Voice notes",
  live_call: "Live call",
  in_person: "In person",
};

const PROMPT_LABEL: Record<PromptKind, string> = {
  pronunciation: "Pronunciation drill",
  debate: "Debate motion",
  gd: "Group discussion topic",
};

const STATUS_STYLE: Record<BuddySession["status"], string> = {
  planned: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  completed: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  missed: "text-zinc-400 bg-zinc-500/10 border-zinc-600/40",
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** `datetime-local` wants a local-time string with no zone suffix. */
function defaultWhen(): string {
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
  soon.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
}

/**
 * The mentee's 1-5 verdict on a session.
 *
 * Read-only for the mentor: a mentor rating their own session would make the
 * only mentoring-quality signal the platform has worthless, so the backend
 * refuses it and this never offers it.
 */
function RatingStars({
  session,
  canRate,
  onChanged,
}: {
  session: BuddySession;
  canRate: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rating = session.mentee_rating;

  const rate = useCallback(
    async (value: number) => {
      setBusy(true);
      setError(null);
      try {
        await rateSession(session.session_id, value);
        onChanged();
      } catch {
        setError("Could not save that rating.");
      } finally {
        setBusy(false);
      }
    },
    [onChanged, session.session_id],
  );

  if (rating === null && !canRate) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-zinc-500">
        {rating !== null
          ? canRate
            ? "You rated this"
            : "Your mentee rated this"
          : "How useful was it?"}
      </span>
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((value) => {
          const filled = rating !== null && value <= rating;
          const star = (
            <Star
              className={`w-4 h-4 ${filled ? "fill-amber-400 text-amber-400" : "text-zinc-600"}`}
            />
          );
          // Once rated it is a record, not a control — and the mentor never
          // gets one in the first place.
          return canRate && rating === null ? (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => void rate(value)}
              aria-label={`Rate ${value} out of 5`}
              className="p-0.5 rounded transition hover:scale-110 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              {star}
            </button>
          ) : (
            <span key={value} aria-hidden className="p-0.5">
              {star}
            </span>
          );
        })}
      </div>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}

function SessionRow({
  session,
  isMentor,
  onChanged,
}: {
  session: BuddySession;
  isMentor: boolean;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const myNote = isMentor ? session.mentor_notes : session.mentee_reflection;
  const theirNote = isMentor ? session.mentee_reflection : session.mentor_notes;

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        setOpen(false);
        setNote("");
        onChanged();
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  return (
    <li className="card-glass p-4 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-zinc-100">
          {session.topic || "Practice session"}
        </span>
        <span
          className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border ${STATUS_STYLE[session.status]}`}
        >
          {session.status}
        </span>
        <span className="text-xs text-zinc-500 ml-auto">
          {MODE_LABEL[session.mode]} · {formatWhen(session.scheduled_at)}
        </span>
      </div>

      {session.prompt_title && (
        <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 px-3 py-2">
          <span className="text-[10px] uppercase tracking-widest text-teal-300">
            {session.prompt_kind ? PROMPT_LABEL[session.prompt_kind] : "Practice"}
          </span>
          <p className="text-sm text-zinc-200 mt-0.5">{session.prompt_title}</p>
        </div>
      )}

      {(myNote || theirNote) && (
        <div className="space-y-1 text-sm">
          {myNote && (
            <p className="text-zinc-300">
              <span className="text-zinc-600">You: </span>
              {myNote}
            </p>
          )}
          {theirNote && (
            <p className="text-zinc-300">
              <span className="text-zinc-600">
                {isMentor ? "Them: " : "Your mentor: "}
              </span>
              {theirNote}
            </p>
          )}
        </div>
      )}

      {session.status === "planned" && !open && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <Check className="w-3.5 h-3.5" />
            Mark done
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => missSession(session.session_id))}
            className="px-3 py-1.5 rounded-xl text-sm border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            Didn't happen
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => cancelSession(session.session_id))}
            aria-label="Cancel session"
            className="px-2 py-1.5 rounded-xl text-sm text-zinc-600 hover:text-rose-300 transition disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Completed sessions stay open to a note: the other side may not have
          written theirs yet. */}
      {(open || (session.status === "completed" && !myNote)) && (
        <div className="flex gap-2 items-end">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={
              isMentor ? "What did you notice?" : "What are you taking away?"
            }
            aria-label={isMentor ? "Mentor notes" : "Your reflection"}
            className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-brand-500/60"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => completeSession(session.session_id, note.trim()))
            }
            className="btn-primary px-3 py-2 text-sm disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </button>
        </div>
      )}

      {session.status === "completed" && (
        <RatingStars
          session={session}
          canRate={!isMentor}
          onChanged={onChanged}
        />
      )}
    </li>
  );
}

export function SessionsPanel({
  pairId,
  isMentor,
  hasCycle,
  onChanged,
}: {
  pairId: string;
  isMentor: boolean;
  hasCycle: boolean;
  /** Lets the parent refresh the cycle header's kept-sessions count. */
  onChanged: () => void;
}) {
  const [sessions, setSessions] = useState<BuddySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [when, setWhen] = useState(defaultWhen);
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<SessionMode>("async_voice");
  const [planning, setPlanning] = useState(false);

  // Practice material. Fetched once — these catalogs ship with the app.
  const [prompts, setPrompts] = useState<PracticePrompt[]>([]);
  const [promptKind, setPromptKind] = useState<PromptKind | "">("");
  const [promptId, setPromptId] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchSessions(pairId);
      setSessions(data.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sessions.");
    } finally {
      setLoading(false);
    }
  }, [pairId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A pair can still plan a plain session if the catalogs fail to load, so a
  // failure here is silent rather than an error banner over the whole panel.
  useEffect(() => {
    fetchPracticePrompts()
      .then((data) => setPrompts(data.prompts))
      .catch(() => setPrompts([]));
  }, []);

  const choices = useMemo(
    () => (promptKind ? prompts.filter((p) => p.kind === promptKind) : []),
    [promptKind, prompts],
  );

  const chosen = useMemo(
    () => choices.find((p) => p.id === promptId) ?? null,
    [choices, promptId],
  );

  const refresh = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  const handlePlan = useCallback(async () => {
    if (!when) return;
    setPlanning(true);
    setError(null);
    try {
      // `datetime-local` gives local wall time; the backend stores ISO.
      await planSession(
        pairId,
        new Date(when).toISOString(),
        topic.trim(),
        mode,
        chosen ? { kind: chosen.kind, id: chosen.id } : null,
      );
      setTopic("");
      setPromptId("");
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message.includes("no_active_cycle")
          ? "This pairing has no cycle running — a teacher needs to start one first."
          : message.includes("prompt_not_found")
            ? "That practice item is no longer in the catalog. Pick another."
            : message || "Could not plan that session.",
      );
    } finally {
      setPlanning(false);
    }
  }, [chosen, mode, pairId, refresh, topic, when]);

  if (!hasCycle) {
    return (
      <div className="card-glass p-5 text-sm text-zinc-400">
        Sessions belong to a cycle, and this pairing has none running. Ask your
        teacher to start one.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card-glass p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-200">Plan a session</h3>
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2">
          <input
            type="datetime-local"
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            aria-label="When"
            className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500/60"
          />
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="What will you work on?"
            aria-label="Topic"
            className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-brand-500/60"
          />
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as SessionMode)}
            aria-label="Mode"
            className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500/60"
          >
            {(Object.keys(MODE_LABEL) as SessionMode[]).map((key) => (
              <option key={key} value={key}>
                {MODE_LABEL[key]}
              </option>
            ))}
          </select>
        </div>

        {/* Optional, and deliberately second: a pair who know what they want to
            work on should not have to pick from a catalog to plan a session. */}
        {prompts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-2">
            <select
              value={promptKind}
              onChange={(event) => {
                setPromptKind(event.target.value as PromptKind | "");
                setPromptId("");
              }}
              aria-label="Practice material"
              className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500/60"
            >
              <option value="">No set material</option>
              {(Object.keys(PROMPT_LABEL) as PromptKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {PROMPT_LABEL[kind]}
                </option>
              ))}
            </select>
            {promptKind && (
              <select
                value={promptId}
                onChange={(event) => setPromptId(event.target.value)}
                aria-label="Practice item"
                className="bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-brand-500/60"
              >
                <option value="">Pick one…</option>
                {choices.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.title.slice(0, 90)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {chosen?.detail && (
          <p className="text-xs text-zinc-500 leading-relaxed">{chosen.detail}</p>
        )}

        {error && <p className="text-sm text-rose-300">{error}</p>}
        <button
          type="button"
          onClick={() => void handlePlan()}
          disabled={planning || !when}
          className="btn-primary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        >
          {planning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CalendarPlus className="w-4 h-4" />
          )}
          Plan it
        </button>
      </div>

      {loading ? (
        <div className="card-glass p-5 text-sm text-zinc-500">Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div className="card-glass p-5 text-sm text-zinc-400">
          No sessions yet. Planning one is what turns a chat into practice.
        </div>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => (
            <SessionRow
              key={session.session_id}
              session={session}
              isMentor={isMentor}
              onChanged={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
