import { useEffect, useState } from "react";
import {
  Check,
  GitCompare,
  Mic,
  Sparkles,
  Upload,
  type LucideIcon,
} from "lucide-react";

interface ProcessingStep {
  label: string;
  icon: LucideIcon;
}

const STEPS: ProcessingStep[] = [
  { label: "Uploading audio", icon: Upload },
  { label: "Transcribing speech", icon: Mic },
  { label: "Comparing with target", icon: GitCompare },
  { label: "Generating feedback", icon: Sparkles },
];

const STEP_INTERVAL_MS = 600;

export function ProcessingView() {
  // Step advances on a fixed timer until completion. Animation is cosmetic;
  // the parent handles the real network resolution.
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    setActiveStep(0);
    const id = window.setInterval(() => {
      setActiveStep((prev) =>
        prev >= STEPS.length - 1 ? STEPS.length - 1 : prev + 1,
      );
    }, STEP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div key="processing" className="animate-scale-in">
      <section className="card-glass p-10 md:p-14 flex flex-col items-center gap-10">
        <div className="relative w-32 h-32">
          <div
            className="absolute inset-0 rounded-full animate-spin-slow"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, transparent 200deg, #818cf8 320deg, #6366f1 360deg)",
              filter: "blur(0.5px)",
              animationDuration: "1.2s",
              animationTimingFunction: "linear",
            }}
          />
          <div className="absolute inset-2 rounded-full bg-zinc-950 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-brand-300" strokeWidth={2.4} />
          </div>
          <div className="absolute inset-0 rounded-full bg-brand-500/20 blur-2xl -z-10" />
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-zinc-100 tracking-tight">
            Scoring your pronunciation
          </h2>
          <p className="text-sm text-zinc-500">
            This usually takes a few seconds.
          </p>
        </div>

        <ol className="w-full max-w-md space-y-3">
          {STEPS.map((step, index) => {
            const isDone = index < activeStep;
            const isActive = index === activeStep;
            const Icon = step.icon;
            return (
              <li
                key={step.label}
                className={[
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-300",
                  isActive
                    ? "bg-brand-500/10 border border-brand-500/30"
                    : isDone
                      ? "bg-emerald-500/5 border border-emerald-500/20"
                      : "border border-transparent",
                ].join(" ")}
              >
                <span
                  className={[
                    "w-7 h-7 rounded-lg flex items-center justify-center transition-colors",
                    isDone
                      ? "bg-emerald-500/20 text-emerald-300"
                      : isActive
                        ? "bg-brand-500/20 text-brand-300 animate-glow-pulse"
                        : "bg-zinc-800/60 text-zinc-500",
                  ].join(" ")}
                >
                  {isDone ? (
                    <Check className="w-4 h-4" strokeWidth={2.6} />
                  ) : (
                    <Icon className="w-4 h-4" strokeWidth={2.4} />
                  )}
                </span>
                <span
                  className={[
                    "text-sm font-medium",
                    isDone
                      ? "text-emerald-300"
                      : isActive
                        ? "text-brand-200"
                        : "text-zinc-500",
                  ].join(" ")}
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
