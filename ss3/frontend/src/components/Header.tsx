import { Activity, Sparkles } from 'lucide-react';

interface Props {
  onHome: () => void;
}

export default function Header({ onHome }: Props) {
  return (
    <header className="sticky top-0 z-20 backdrop-blur-2xl bg-zinc-950/60 border-b border-zinc-800/60">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <button
          onClick={onHome}
          className="flex items-center gap-3 group transition-transform active:scale-95"
          aria-label="Home"
        >
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-brand-500 to-fuchsia-500 rounded-xl blur-md opacity-50 group-hover:opacity-80 transition-opacity" />
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-fuchsia-600 flex items-center justify-center shadow-glow-sm group-hover:shadow-glow transition-all">
              <Activity className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div className="text-left">
            <div className="font-bold text-zinc-50 leading-tight tracking-tight">
              Communication Skills Analyzer
            </div>
            <div className="text-xs text-zinc-400 leading-tight flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              AI-powered body language coaching
            </div>
          </div>
        </button>
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-medium text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          Local · Private
        </div>
      </div>
    </header>
  );
}
