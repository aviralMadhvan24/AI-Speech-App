import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, Volume2 } from "lucide-react";
import { getCurrentIdToken } from "../hooks/useAuth";
import { Avatar } from "./Avatar";

/**
 * A single per-speaker audio item. Intentionally a structural superset that is
 * compatible with BOTH `CompletedTurnPublic` (from the live room state) and
 * `DebateTurnAudioRef` (from `my-debates` / debate-detail). `ai_score` is
 * optional because post-debate audio refs do not carry a score.
 */
export interface DebateTurnAudioItem {
  turn_index: number;
  participant_id: string;
  display_name: string;
  audio_url: string | null;
  is_forfeit: boolean;
  ai_score?: number;
}

interface DebateTurnsAudioProps {
  /** Per-turn audio items. Rendered in ascending `turn_index` order. */
  turns: DebateTurnAudioItem[];
  /** participant_id -> avatar URL, so each turn can show the speaker's photo. */
  avatarByParticipant?: Record<string, string | null>;
  /** Optional heading shown above the list. */
  title?: string;
}

// Base URL for the audio route. Matches the fetch conventions in debateApi.ts:
// relative by default (Vite proxy), or the deployed backend via VITE_API_URL.
const API_BASE_URL = import.meta.env.VITE_API_URL || "";

/**
 * Shared per-speaker playback list for completed debate turns. Used by both the
 * debate results/completion screen and the profile "My Debates" panel so the
 * playback experience stays identical in every surface.
 *
 * Forfeit turns (or turns without an `audio_url`) render no playback control.
 * Only one turn plays at a time; the play/pause button keeps a fixed size so
 * pressing it never shifts the surrounding layout.
 */
export function DebateTurnsAudio({
  turns,
  avatarByParticipant = {},
  title = "Completed Turns",
}: DebateTurnsAudioProps) {
  // Track the currently-playing turn by its stable key so the button state and
  // the single shared <audio> element stay in sync.
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Object URL for the currently-loaded blob, revoked when we switch/stop.
  const objectUrlRef = useRef<string | null>(null);

  const keyFor = (turn: DebateTurnAudioItem) =>
    `${turn.participant_id}-${turn.turn_index}`;

  const revokeObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  const handlePlay = async (turn: DebateTurnAudioItem) => {
    if (!turn.audio_url) return;
    const key = keyFor(turn);

    // Toggle: pressing the active turn pauses it.
    if (playingKey === key) {
      audioRef.current?.pause();
      setPlayingKey(null);
      return;
    }

    // Stop any current playback before starting a new turn.
    audioRef.current?.pause();
    revokeObjectUrl();

    // The audio-serve route requires auth (Firebase bearer token), which a
    // bare <audio src> / new Audio(url) request cannot send. So fetch the
    // bytes with the Authorization header, wrap them in an object URL, and
    // play that instead.
    setLoadingKey(key);
    try {
      const token = await getCurrentIdToken();
      const resp = await fetch(`${API_BASE_URL}${turn.audio_url}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        setLoadingKey(null);
        setPlayingKey(null);
        return;
      }
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;

      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingKey(null);
        revokeObjectUrl();
      };
      audio.onerror = () => {
        setPlayingKey(null);
        revokeObjectUrl();
      };

      await audio.play();
      setLoadingKey(null);
      setPlayingKey(key);
    } catch {
      setLoadingKey(null);
      setPlayingKey(null);
      revokeObjectUrl();
    }
  };

  // Stop playback + free the blob URL if the component unmounts.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      revokeObjectUrl();
    };
  }, []);

  if (turns.length === 0) return null;

  const ordered = [...turns].sort((a, b) => a.turn_index - b.turn_index);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
        <Volume2 className="w-3 h-3" aria-hidden />
        {title}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ordered.map((turn) => {
          const key = keyFor(turn);
          const isPlaying = playingKey === key;
          const isLoading = loadingKey === key;
          const hasAudio = !!turn.audio_url && !turn.is_forfeit;
          return (
            <div
              key={key}
              className="card-glass px-3 py-2 flex items-center gap-2"
            >
              <Avatar
                src={avatarByParticipant[turn.participant_id]}
                name={turn.display_name}
                className="w-8 h-8 bg-[var(--raised)] border border-[var(--hairline-strong)] text-xs font-semibold text-white"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-zinc-100 truncate">
                  {turn.display_name}
                </div>
                <div className="text-[10px] text-zinc-500">
                  Speaker {turn.turn_index + 1}
                  {typeof turn.ai_score === "number" &&
                    ` · ${turn.ai_score.toFixed(0)}/100`}
                </div>
              </div>
              {hasAudio ? (
                <button
                  type="button"
                  onClick={() => void handlePlay(turn)}
                  disabled={isLoading}
                  className="btn-ghost p-2 text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:opacity-60"
                  aria-label={
                    isPlaying
                      ? `Pause ${turn.display_name}'s turn`
                      : `Play ${turn.display_name}'s turn`
                  }
                  aria-pressed={isPlaying}
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  ) : isPlaying ? (
                    <Pause className="w-4 h-4 text-brand-300" aria-hidden />
                  ) : (
                    <Play className="w-4 h-4" aria-hidden />
                  )}
                </button>
              ) : (
                <span className="text-[10px] text-zinc-600 px-2">
                  {turn.is_forfeit ? "Forfeit" : "No audio"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
