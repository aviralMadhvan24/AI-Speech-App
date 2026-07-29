import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, MessageSquareText, Plus, Trash2, Users2 } from "lucide-react";
import { useToast } from "../Toast";
import { getCurrentIdToken } from "../../hooks/useAuth";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

interface CatalogEntry {
  id: string;
  title: string;
  text: string;
  category?: string;
  is_custom: boolean;
  created_by: string | null;
}

type Kind = "motion" | "topic";

const ENDPOINT: Record<Kind, string> = {
  motion: "/admin/debate-motions",
  topic: "/admin/gd-topics",
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getCurrentIdToken();
  const headers = new Headers(init?.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

async function fetchCatalog(kind: Kind): Promise<CatalogEntry[]> {
  const res = await authedFetch(ENDPOINT[kind]);
  if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
  return res.json();
}

async function createEntry(
  kind: Kind,
  body: { title: string; text: string; category?: string },
): Promise<CatalogEntry> {
  const res = await authedFetch(ENDPOINT[kind], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 422) {
    throw new Error("Title needs 4+ characters and the body needs 20+.");
  }
  if (!res.ok) throw new Error(`Could not save: ${res.status}`);
  return res.json();
}

async function deleteEntry(kind: Kind, id: string): Promise<void> {
  const res = await authedFetch(`${ENDPOINT[kind]}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Could not delete: ${res.status}`);
}

// ---------------------------------------------------------------------------
// One catalog panel (motions or topics)
// ---------------------------------------------------------------------------

const COPY: Record<
  Kind,
  {
    heading: string;
    blurb: string;
    icon: typeof MessageSquareText;
    accent: string;
    titleLabel: string;
    titlePlaceholder: string;
    bodyLabel: string;
    bodyPlaceholder: string;
  }
> = {
  motion: {
    heading: "Debate Motions",
    blurb:
      "One motion is picked at random when a student creates a debate room. Added motions go into that pool immediately.",
    icon: MessageSquareText,
    accent: "text-violet-300",
    titleLabel: "Motion title",
    titlePlaceholder: "Social Media Does More Harm Than Good for Teenagers",
    bodyLabel: "Motion text",
    bodyPlaceholder:
      "This house believes that... (spell out the exact claim students must argue for or against)",
  },
  topic: {
    heading: "Group Discussion Topics",
    blurb:
      "One topic is picked at random when a student creates a GD room. Added topics go into that pool immediately.",
    icon: Users2,
    accent: "text-emerald-300",
    titleLabel: "Topic title",
    titlePlaceholder: "Work From Home vs Office",
    bodyLabel: "Topic brief",
    bodyPlaceholder:
      "Discuss the pros and cons of... (list the angles you want students to cover)",
  },
};

function CatalogPanel({ kind }: { kind: Kind }) {
  const copy = COPY[kind];
  const Icon = copy.icon;
  const toast = useToast();

  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await fetchCatalog(kind));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setTitle("");
    setText("");
    setCategory("general");
    setFormError(null);
  };

  const handleSave = async () => {
    const trimmedTitle = title.trim();
    const trimmedText = text.trim();
    if (trimmedTitle.length < 4) {
      setFormError("Title needs at least 4 characters.");
      return;
    }
    if (trimmedText.length < 20) {
      setFormError("Body needs at least 20 characters so students have something to work with.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await createEntry(kind, {
        title: trimmedTitle,
        text: trimmedText,
        ...(kind === "topic" ? { category: category.trim() || "general" } : {}),
      });
      toast.success("Saved", `${trimmedTitle} is now in the pool`);
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: CatalogEntry) => {
    if (!confirm(`Delete "${entry.title}"? Students will stop being assigned it.`)) return;
    setDeletingId(entry.id);
    try {
      await deleteEntry(kind, entry.id);
      toast.success("Deleted", entry.title);
      await load();
    } catch (err) {
      toast.error("Delete failed", err instanceof Error ? err.message : "");
    } finally {
      setDeletingId(null);
    }
  };

  const customCount = entries.filter((e) => e.is_custom).length;

  return (
    <section className="card-glass p-5 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Icon className={`w-5 h-5 ${copy.accent}`} />
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">{copy.heading}</h2>
            <p className="text-xs text-zinc-500 mt-0.5 max-w-xl leading-relaxed">
              {copy.blurb}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm((prev) => !prev);
            setFormError(null);
          }}
          className="btn-primary px-3 py-1.5 text-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 space-y-3">
          <div>
            <label
              htmlFor={`${kind}-title`}
              className="block text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1"
            >
              {copy.titleLabel}
            </label>
            <input
              id={`${kind}-title`}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={copy.titlePlaceholder}
              maxLength={120}
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
            />
          </div>

          <div>
            <label
              htmlFor={`${kind}-text`}
              className="block text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1"
            >
              {copy.bodyLabel}
            </label>
            <textarea
              id={`${kind}-text`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={copy.bodyPlaceholder}
              rows={3}
              maxLength={1000}
              className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand-500/60 resize-y"
            />
            <div className="text-[10px] text-zinc-600 mt-1 tabular-nums">
              {text.trim().length} / 1000 characters
            </div>
          </div>

          {kind === "topic" && (
            <div>
              <label
                htmlFor={`${kind}-category`}
                className="block text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1"
              >
                Category
              </label>
              <input
                id={`${kind}-category`}
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="general"
                maxLength={40}
                className="w-full sm:w-56 bg-zinc-900/60 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
              />
            </div>
          )}

          {formError && <div className="text-xs text-rose-300">{formError}</div>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="btn-primary px-4 py-2 text-xs"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="btn-ghost px-3 py-2 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-4">
          <Loader2 className="w-4 h-4 animate-spin text-brand-300" />
          Loading catalog…
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-300 border border-rose-500/40 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="text-xs text-zinc-500 tabular-nums">
            {entries.length} in the pool · {customCount} added by teachers
          </div>
          <ul className="space-y-2" role="list">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl px-3 py-2.5 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-100">{entry.title}</span>
                    {entry.is_custom ? (
                      <span className="chip-emerald text-[9px]">Added</span>
                    ) : (
                      <span className="chip-zinc text-[9px] inline-flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" />
                        Built-in
                      </span>
                    )}
                    {entry.category && (
                      <span className="text-[9px] uppercase tracking-widest text-zinc-500">
                        {entry.category}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{entry.text}</p>
                  {entry.created_by && (
                    <p className="text-[10px] text-zinc-600 mt-1">by {entry.created_by}</p>
                  )}
                </div>
                {entry.is_custom && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(entry)}
                    disabled={deletingId === entry.id}
                    className="btn-ghost p-2 text-rose-300 hover:bg-rose-500/10 shrink-0"
                    aria-label={`Delete ${entry.title}`}
                  >
                    {deletingId === entry.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Both panels
// ---------------------------------------------------------------------------

export function TopicManager() {
  return (
    <div className="space-y-4">
      <CatalogPanel kind="motion" />
      <CatalogPanel kind="topic" />
    </div>
  );
}
