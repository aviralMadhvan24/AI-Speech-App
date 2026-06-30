import { useCallback, useEffect, useRef, useState } from "react";

// Minimal types for the Web Speech API since they're not in the default lib.

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

function describeError(code: string): string {
  switch (code) {
    case "audio-capture":
      return "No microphone was found. Connect a mic and check Settings → Privacy → Microphone, then try again.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Allow mic access for this site (click the padlock icon in the address bar) and try again.";
    case "network":
      return "A network error occurred. Speech recognition needs an internet connection in most browsers.";
    default:
      return `Speech recognition error: ${code}`;
  }
}

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

export function useSpeechRecognition({
  onResult,
  lang = "en-US",
}: UseSpeechRecognitionOptions = {}): UseSpeechRecognition {
  const isSupported = Boolean(SpeechRecognitionCtor);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const listeningRef = useRef(false);
  const onResultRef = useRef(onResult);
  const seenCountRef = useRef(0);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const ensureRecognition = useCallback((): SpeechRecognitionInstance | null => {
    if (!SpeechRecognitionCtor) return null;
    if (recognitionRef.current) return recognitionRef.current;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = lang;

    recognition.onstart = () => {
      seenCountRef.current = 0;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const allWords: string[] = [];
      let interim = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const alternative = result[0];
        const text = alternative?.transcript ?? "";
        text
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0)
          .forEach((w) => allWords.push(w));
        if (!result.isFinal) interim += text;
      }

      const newWords = allWords.slice(seenCountRef.current);
      if (allWords.length > seenCountRef.current) {
        seenCountRef.current = allWords.length;
      }

      setError(null);
      if (newWords.length > 0 || interim) {
        onResultRef.current?.({ newWords, interim });
      }
    };

    recognition.onend = () => {
      if (listeningRef.current) {
        try {
          recognition.start();
        } catch {
          /* already starting */
        }
      } else {
        setIsListening(false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.error("Speech recognition error:", event.error);
      setError(describeError(event.error));
      if (
        event.error === "audio-capture" ||
        event.error === "not-allowed" ||
        event.error === "service-not-allowed"
      ) {
        listeningRef.current = false;
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [lang]);

  const start = useCallback(() => {
    const recognition = ensureRecognition();
    if (!recognition) return;
    setError(null);
    seenCountRef.current = 0;
    listeningRef.current = true;
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      /* already started */
    }
  }, [ensureRecognition]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    setIsListening(false);
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* not running */
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      listeningRef.current = false;
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  return { isSupported, isListening, error, start, stop };
}
