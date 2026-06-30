import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from 0 (or its previous value) to `target` over `durationMs`
 * using an ease-out cubic curve. Returns the current animated value.
 */
export function useCountUp(target: number, durationMs: number = 800): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setValue(0);
      return;
    }
    fromRef.current = 0;
    startRef.current = null;

    const tick = (timestamp: number) => {
      if (startRef.current == null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(1, elapsed / Math.max(1, durationMs));
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const next = fromRef.current + (target - fromRef.current) * eased;
      setValue(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, durationMs]);

  return value;
}
