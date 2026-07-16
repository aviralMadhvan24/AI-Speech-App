/**
 * useSpeechRecognition - Web Speech API hook (rewritten from scratch)
 * 
 * Key Design:
 * - Only emits words from FINAL results (not interim duplicates)
 * - Tracks the last emitted final transcript to detect truly new words
 * - Handles browser auto-restart gracefully without double-counting
 * - Interim text shown for UX only (never counted for WPM)
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Web Speech API types
// ---------------------------------------------------------------------------

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const SpeechRecognitionCtor: SpeechRecognitionConstructor | null =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition || null
    : null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpeechResult {
  newWords: string[];
  interim: string;
}

interface UseSpeechRecognitionOptions {
  onResult?: (result: SpeechResult) => void;
  lang?: string;
}

export interface UseSpeechRecognition {
  isSupported: boolean;
  isListening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function describeError(code: string): string {
  switch (code) {
    case "audio-capture":
      return "No microphone found. Check mic connection and browser permissions.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access blocked. Click the padlock icon in the address bar to allow mic access.";
    case "network":
      return "Network error. Speech recognition needs internet connection in most browsers.";
    default:
      return `Speech recognition error: ${code}`;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSpeechRecognition({
  onResult,
  lang = "en-US",
}: UseSpeechRecognitionOptions = {}): UseSpeechRecognition {
  const isSupported = Boolean(SpeechRecognitionCtor);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const wantListeningRef = useRef(false);
  const onResultRef = useRef(onResult);
  
  // Track the cumulative final transcript to detect new words
  const lastFinalIndexRef = useRef(0);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const start = useCallback(() => {
    if (!SpeechRecognitionCtor) return;
    setError(null);
    wantListeningRef.current = true;
    setIsListening(true);
    lastFinalIndexRef.current = 0;

    // Destroy old instance if any
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* noop */ }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = lang;
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const newWords: string[] = [];
      let interim = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = (result[0]?.transcript ?? "").trim();

        if (result.isFinal) {
          // Only process finals we haven't seen yet
          if (i >= lastFinalIndexRef.current) {
            const words = transcript.split(/\s+/).filter((w) => w.length > 0);
            newWords.push(...words);
            lastFinalIndexRef.current = i + 1;
          }
        } else {
          // Latest interim (for display only)
          interim = transcript;
        }
      }

      if (newWords.length > 0 || interim) {
        onResultRef.current?.({ newWords, interim });
      }
      setError(null);
    };

    recognition.onend = () => {
      // Browser stops recognition after ~60s of silence or max duration
      // Auto-restart if user still wants to listen
      if (wantListeningRef.current) {
        lastFinalIndexRef.current = 0; // Results reset on new session
        try {
          recognition.start();
        } catch {
          // If start fails, stop listening
          wantListeningRef.current = false;
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Ignore benign errors
      if (event.error === "no-speech" || event.error === "aborted") return;

      console.warn("Speech recognition error:", event.error);
      setError(describeError(event.error));

      // Fatal errors - stop listening
      if (
        event.error === "audio-capture" ||
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        wantListeningRef.current = false;
        setIsListening(false);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      setError("Could not start speech recognition.");
      wantListeningRef.current = false;
      setIsListening(false);
    }
  }, [lang]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    setIsListening(false);
    const recognition = recognitionRef.current;
    if (recognition) {
      try { recognition.stop(); } catch { /* noop */ }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      const recognition = recognitionRef.current;
      if (recognition) {
        try { recognition.abort(); } catch { /* noop */ }
      }
    };
  }, []);

  return { isSupported, isListening, error, start, stop };
}
