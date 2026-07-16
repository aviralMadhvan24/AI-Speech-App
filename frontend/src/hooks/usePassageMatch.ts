import { useCallback, useMemo, useRef, useState } from "react";
import { normalizeWord } from "../utils/paceZones";

export type TokenStatus = "correct" | "wrong" | null;

function levenshtein1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (la > lb) i++;
      else if (lb > la) j++;
      else {
        i++;
        j++;
      }
    }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}

function wordsMatch(target: string, spoken: string): boolean {
  if (!target || !spoken) return false;
  if (target === spoken) return true;
  if (target.length >= 4 && spoken.length >= 4) {
    if (target.startsWith(spoken) || spoken.startsWith(target)) return true;
  }
  if (Math.abs(target.length - spoken.length) <= 1 && levenshtein1(target, spoken)) {
    return true;
  }
  return false;
}

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
  const matchedRef = useRef(0);
  const statusRef = useRef<TokenStatus[]>([]);

  const advance = useCallback(
    (spokenWords: string[]) => {
      let count = matchedRef.current;
      const status: TokenStatus[] = statusRef.current.slice();
      while (status.length < normalized.length) status.push(null);

      spokenWords.forEach((sw) => {
        const norm = normalizeWord(sw);
        if (!norm) return;

        while (count < normalized.length && (normalized[count] ?? "").length === 0) {
          status[count] = "correct";
          count++;
        }
        if (count >= normalized.length) return;

        const expected = normalized[count] ?? "";
        if (wordsMatch(expected, norm)) {
          status[count] = "correct";
          count++;
          return;
        }

        // Look ahead max 3 words (reduced from 6 to prevent excessive skipping)
        let found = -1;
        for (let look = 1; look <= 3; look++) {
          const idx = count + look;
          if (idx < normalized.length && wordsMatch(normalized[idx] ?? "", norm)) {
            found = idx;
            break;
          }
        }
        if (found >= 0) {
          // Only mark skipped words as "wrong" if gap is small (≤2)
          // Larger gaps are likely recognition errors, not user mistakes
          if (found - count <= 2) {
            for (let k = count; k < found; k++) status[k] = "wrong";
          }
          status[found] = "correct";
          count = found + 1;
        } else {
          // Don't mark as wrong immediately - could be filler word or recognition error
          // Just skip this spoken word without advancing
          // Only mark wrong if we're confident the user skipped it
        }
      });

      statusRef.current = status;
      matchedRef.current = count;
      setStatuses(status.slice());
      setMatchedCount(count);
    },
    [normalized],
  );

  const reset = useCallback(() => {
    matchedRef.current = 0;
    statusRef.current = [];
    setMatchedCount(0);
    setStatuses([]);
  }, []);

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
