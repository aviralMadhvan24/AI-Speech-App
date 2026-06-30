import { useState } from "react";
import { ArrowLeft, KeyRound, Plus, Swords } from "lucide-react";
import { createRoom, joinRoom } from "../battleApi";
import type { CreateRoomResponse, JoinRoomResponse } from "../battleApi";

interface BattleLobbyViewProps {
  onCreated: (response: CreateRoomResponse) => void;
  onJoined: (response: JoinRoomResponse) => void;
  onBack: () => void;
}

export function BattleLobbyView({ onCreated, onJoined, onBack }: BattleLobbyViewProps) {
  const [hostName, setHostName] = useState("Player 1");
  const [joinName, setJoinName] = useState("Player 2");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!hostName.trim() || creating) return;
    setError(null);
    setCreating(true);
    try {
      const response = await createRoom(hostName.trim());
      onCreated(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create room.");
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    if (!joinName.trim() || !code.trim() || joining) return;
    setError(null);
    setJoining(true);
    try {
      const response = await joinRoom(code.trim(), joinName.trim());
      onJoined(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join room.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <div key="battle-lobby" className="animate-fade-in-up space-y-6">
      <section className="card-glass p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="btn-ghost px-3 py-1.5">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className="chip bg-fuchsia-500/10 text-fuchsia-300 border border-fuchsia-500/30">
            <Swords className="w-3 h-3" />
            1v1 Battle
          </span>
        </div>
        <div className="text-xs text-zinc-500">
          Same prompt, same timer. Best pronunciation wins.
        </div>
      </section>

      {error && (
        <div className="card-glass px-4 py-3 text-sm text-rose-300 border-rose-500/40">
          {error}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Create */}
        <section className="card-glass p-6 md:p-8 flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-lg bg-fuchsia-500/15 text-fuchsia-300 flex items-center justify-center">
              <Plus className="w-4 h-4" strokeWidth={2.6} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-zinc-100 tracking-tight">Create Battle</h2>
              <p className="text-xs text-zinc-500">Generate a room code and share it.</p>
            </div>
          </div>

          <label className="space-y-1.5">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Your name
            </span>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value.slice(0, 40))}
              maxLength={40}
              placeholder="Player 1"
              className="w-full rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-fuchsia-500/60 focus:ring-1 focus:ring-fuchsia-500/40"
            />
          </label>

          <button
            type="button"
            onClick={handleCreate}
            disabled={!hostName.trim() || creating}
            className="btn-primary"
            style={{
              backgroundImage:
                "linear-gradient(135deg, #a21caf 0%, #c026d3 100%)",
            }}
          >
            <Plus className="w-4 h-4" strokeWidth={2.6} />
            {creating ? "Creating…" : "Create Room"}
          </button>
        </section>

        {/* Join */}
        <section className="card-glass p-6 md:p-8 flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-lg bg-cyan-500/15 text-cyan-300 flex items-center justify-center">
              <KeyRound className="w-4 h-4" strokeWidth={2.6} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-zinc-100 tracking-tight">Join Battle</h2>
              <p className="text-xs text-zinc-500">Enter the 6-character code.</p>
            </div>
          </div>

          <label className="space-y-1.5">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Your name
            </span>
            <input
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value.slice(0, 40))}
              maxLength={40}
              placeholder="Player 2"
              className="w-full rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/40"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Room code
            </span>
            <input
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
              }
              maxLength={6}
              placeholder="K7M2X9"
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full rounded-xl bg-zinc-900/60 border border-zinc-800 px-3 py-2.5 text-lg font-mono tracking-[0.4em] text-center text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/40"
            />
          </label>

          <button
            type="button"
            onClick={handleJoin}
            disabled={!joinName.trim() || code.length !== 6 || joining}
            className="btn-primary"
            style={{
              backgroundImage:
                "linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)",
            }}
          >
            <KeyRound className="w-4 h-4" strokeWidth={2.6} />
            {joining ? "Joining…" : "Join Room"}
          </button>
        </section>
      </div>
    </div>
  );
}
