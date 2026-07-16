/**
 * useWpm - Words Per Minute calculation (rewritten from scratch)
 * 
 * Logic:
 * - Tracks timestamps of each word spoken
 * - Current WPM = words in last 10 seconds × 6 (extrapolated to 60s)
 * - Average WPM = total words / total elapsed minutes
 * - Updates every 500ms while running
 */

import { useCallback, useEffect, useRef, useState } from "react";

const ROLLING_WINDOW_MS = 10_000; // 10 second rolling window
const TICK_INTERVAL_MS = 500;

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

  // Timestamps of when each word was spoken
  const wordTimestampsRef = useRef<number[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const totalWordsRef = useRef(0);

  const addWords = useCallback((words: string[] | number) => {
    const now = Date.now();
    const count = Array.isArray(words) ? words.length : Math.max(0, Number(words) || 0);
    
    if (count === 0) return;

    // Set start time on first word
    if (startTimeRef.current === null) {
      startTimeRef.current = now;
    }

    // Add one timestamp per word (all at current time)
    for (let i = 0; i < count; i++) {
      wordTimestampsRef.current.push(now);
    }
    
    totalWordsRef.current += count;
    setTotalWords(totalWordsRef.current);
  }, []);

  const computeCurrentWpm = useCallback((): number => {
    const now = Date.now();
    const cutoff = now - ROLLING_WINDOW_MS;
    
    // Count words in the rolling window
    const recentWords = wordTimestampsRef.current.filter((t) => t >= cutoff);
    
    if (recentWords.length === 0) return 0;
    
    // WPM = (words in window) / (window duration in minutes)
    // Using actual window duration (time since first word in window)
    const windowStart = recentWords[0];
    const windowDuration = (now - windowStart) / 1000; // seconds
    
    if (windowDuration < 1) return 0; // Need at least 1 second of data
    
    const wpm = Math.round((recentWords.length / windowDuration) * 60);
    return Math.min(wpm, 300); // Cap at 300 to prevent UI glitches
  }, []);

  const computeAvgWpm = useCallback((): number => {
    if (startTimeRef.current === null || totalWordsRef.current === 0) return 0;
    const elapsedMin = (Date.now() - startTimeRef.current) / 1000 / 60;
    if (elapsedMin < 0.05) return 0; // Need at least 3 seconds
    return Math.round(totalWordsRef.current / elapsedMin);
  }, []);

  const reset = useCallback(() => {
    wordTimestampsRef.current = [];
    startTimeRef.current = null;
    totalWordsRef.current = 0;
    setCurrentWpm(0);
    setTotalWords(0);
    setElapsedSecs(0);
    setAvgWpm(0);
  }, []);

  // Periodic update while running
  useEffect(() => {
    if (!running) return;

    const tick = () => {
      setCurrentWpm(computeCurrentWpm());
      setAvgWpm(computeAvgWpm());
      
      if (startTimeRef.current !== null) {
        setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
      
      // Garbage collect old timestamps (keep only last 30s)
      const cutoff = Date.now() - 30_000;
      wordTimestampsRef.current = wordTimestampsRef.current.filter((t) => t >= cutoff);
    };

    const id = setInterval(tick, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running, computeCurrentWpm, computeAvgWpm]);

  return { currentWpm, totalWords, elapsedSecs, avgWpm, addWords, reset };
}
