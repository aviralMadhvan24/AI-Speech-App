/**
 * usePassageMatch - Tracks reading progress through a passage (rewritten)
 * 
 * Logic:
 * - Sequential matching: user must read words in order
 * - Fuzzy matching with Levenshtein distance ≤1 for typo tolerance
 * - Lookahead of 2 words max (handles small recognition gaps)
 * - Never marks "wrong" unless user clearly skipped ahead
 * - Progress is one-directional (can't go backwards)
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { normalizeWord } from "../utils/paceZones";

export type TokenStatus = "correct" | "wrong" | null;

// ---------------------------------------------------------------------------
// Word matching helpers
// ---------------------------------------------------------------------------

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return matrix[a.length][b.length];
}

function wordsMatch(expected: string, spoken: string): boolean {
  if (!expected || !spoken) return false;
  if (expected === spoken) return true;
  
  // Prefix match for long words (recognition might cut off)
  if (expected.length >= 5 && spoken.length >= 4) {
    if (expected.startsWith(spoken) || spoken.startsWith(expected)) return true;
  }
  
  // Levenshtein distance ≤1 for short words, ≤2 for longer words
  const maxDist = Math.max(expected.length, spoken.length) >= 6 ? 2 : 1;
  return levenshteinDistance(expected, spoken) <= maxDist;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UsePassageMatch {
  tokens: string[];
  statuses: TokenStatus[];
  matchedCount: number;
  progressPct: number;
  accuracyPct: number;
  wrongCount: number;
  advance: (spokenWords: string[]) => void;
  reset: () => void;
}

export function usePassageMatch(text: string): UsePassageMatch {
  const tokens = useMemo(() => (text ? text.split(/\s+/) : []), [text]);
  const normalized = useMemo(() => tokens.map(normalizeWord), [tokens]);

  const [matchedCount, setMatchedCount] = useState(0);
  const [statuses, setStatuses] = useState<TokenStatus[]>([]);
  
  // Use refs for the matching logic to avoid stale closure issues
  const cursorRef = useRef(0); // Current position in passage
  const statusRef = useRef<TokenStatus[]>([]);

  const advance = useCallback(
    (spokenWords: string[]) => {
      if (normalized.length === 0) return;
      
      let cursor = cursorRef.current;
      const status = statusRef.current.slice();
      
      // Ensure status array is long enough
      while (status.length < normalized.length) status.push(null);

      for (const sw of spokenWords) {
        const norm = normalizeWord(sw);
        if (!norm || norm.length === 0) continue;
        if (cursor >= normalized.length) break; // Done with passage

        // Try to match at current position
        const expected = normalized[cursor] ?? "";
        if (expected.length === 0) {
          // Skip empty tokens
          cursor++;
          continue;
        }

        if (wordsMatch(expected, norm)) {
          // Direct match at cursor position
          status[cursor] = "correct";
          cursor++;
        } else {
          // Look ahead 1-2 positions (handles recognition gaps)
          let foundAt = -1;
          for (let look = 1; look <= 2 && cursor + look < normalized.length; look++) {
            const ahead = normalized[cursor + look] ?? "";
            if (ahead.length > 0 && wordsMatch(ahead, norm)) {
              foundAt = cursor + look;
              break;
            }
          }

          if (foundAt >= 0) {
            // Found a match ahead - mark skipped words as "wrong"
            for (let k = cursor; k < foundAt; k++) {
              if (status[k] === null) status[k] = "wrong";
            }
            status[foundAt] = "correct";
            cursor = foundAt + 1;
          }
          // If no match found at all, just ignore this spoken word
          // (likely a filler word, "um", recognition artifact, etc.)
          // Don't advance cursor - wait for user to say the right word
        }
      }

      // Update state
      cursorRef.current = cursor;
      statusRef.current = status;
      setStatuses(status.slice());
      setMatchedCount(cursor);
    },
    [normalized],
  );

  const reset = useCallback(() => {
    cursorRef.current = 0;
    statusRef.current = [];
    setMatchedCount(0);
    setStatuses([]);
  }, []);

  // Computed stats
  const totalWords = normalized.filter((w) => w.length > 0).length;
  const progressPct =
    totalWords === 0 ? 0 : Math.min(100, Math.round((matchedCount / totalWords) * 100));
  const wrongCount = statuses.filter((s) => s === "wrong").length;
  const correctCount = statuses.filter((s) => s === "correct").length;
  const accuracyPct =
    correctCount + wrongCount === 0
      ? 100
      : Math.round((correctCount / (correctCount + wrongCount)) * 100);

  return {
    tokens,
    statuses,
    matchedCount,
    progressPct,
    accuracyPct,
    wrongCount,
    advance,
    reset,
  };
}
