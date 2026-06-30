import { useCallback, useEffect, useRef, useState } from 'react';

const WINDOW_MS = 6000; // rolling 6-second window: responsive but stable

/**
 * Tracks words-per-minute over a rolling window, plus totals and averages.
 * @param {boolean} running - while true, the elapsed timer and rolling WPM update.
 */
export function useWpm(running) {
  const [currentWpm, setCurrentWpm] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [avgWpm, setAvgWpm] = useState(0);

  const timestampsRef = useRef([]);
  const startTimeRef = useRef(null);
  const totalRef = useRef(0);

  const computeRollingWpm = useCallback(() => {
    const now = Date.now();
    timestampsRef.current = timestampsRef.current.filter((t) => now - t < WINDOW_MS);
    const stamps = timestampsRef.current;
    const count = stamps.length;
    if (count < 2) return 0;
    // Measure across the actual span of words in the window, but never let a
    // tiny span inflate the rate unrealistically.
    const spanMin = Math.max((now - stamps[0]) / 1000, 1) / 60;
    return Math.round(count / spanMin);
  }, []);

  const addWords = useCallback((words) => {
    const now = Date.now();
    if (startTimeRef.current === null) startTimeRef.current = now;
    const n = Array.isArray(words) ? words.length : Number(words) || 0;
    for (let i = 0; i < n; i++) timestampsRef.current.push(now);
    totalRef.current += n;
    setTotalWords(totalRef.current);
    setCurrentWpm(computeRollingWpm());
  }, [computeRollingWpm]);

  const reset = useCallback(() => {
    timestampsRef.current = [];
    startTimeRef.current = null;
    totalRef.current = 0;
    setCurrentWpm(0);
    setTotalWords(0);
    setElapsedSecs(0);
    setAvgWpm(0);
  }, []);

  // Drive timers while running.
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
