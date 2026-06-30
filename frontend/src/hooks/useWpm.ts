import { useCallback, useEffect, useRef, useState } from "react";

const WINDOW_MS = 6000; // rolling 6-second window

export interface UseWpm {
  currentWpm: number;
  totalWords: number;
  elapsedSecs: number;
  avgWpm: number;
  addWords: (words: string[] | number) => void;
  reset: () => void;
}

export function useWpm(running: boolean): UseWpm {
  const [currentWpm, setCurrentWpm] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [avgWpm, setAvgWpm] = useState(0);

  const timestampsRef = useRef<number[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const totalRef = useRef(0);

  const computeRollingWpm = useCallback((): number => {
    const now = Date.now();
    timestampsRef.current = timestampsRef.current.filter(
      (t) => now - t < WINDOW_MS,
    );
    const stamps = timestampsRef.current;
    const count = stamps.length;
    if (count < 2) return 0;
    const firstStamp = stamps[0];
    if (firstStamp === undefined) return 0;
    const spanMin = Math.max((now - firstStamp) / 1000, 1) / 60;
    return Math.round(count / spanMin);
  }, []);

  const addWords = useCallback(
    (words: string[] | number) => {
      const now = Date.now();
      if (startTimeRef.current === null) startTimeRef.current = now;
      const n = Array.isArray(words) ? words.length : Number(words) || 0;
      for (let i = 0; i < n; i++) timestampsRef.current.push(now);
      totalRef.current += n;
      setTotalWords(totalRef.current);
      setCurrentWpm(computeRollingWpm());
    },
    [computeRollingWpm],
  );

  const reset = useCallback(() => {
    timestampsRef.current = [];
    startTimeRef.current = null;
    totalRef.current = 0;
    setCurrentWpm(0);
    setTotalWords(0);
    setElapsedSecs(0);
    setAvgWpm(0);
  }, []);

  useEffect(() => {
    if (!running) return undefined;

    const tick = () => {
      setCurrentWpm(computeRollingWpm());
      if (startTimeRef.current) {
        const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setElapsedSecs(secs);
        if (secs > 0 && totalRef.current > 0) {
          setAvgWpm(Math.round(totalRef.current / (secs / 60)));
        }
      }
    };

    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [running, computeRollingWpm]);

  return { currentWpm, totalWords, elapsedSecs, avgWpm, addWords, reset };
}
