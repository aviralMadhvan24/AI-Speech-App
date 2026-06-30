import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

function describeError(code) {
  switch (code) {
    case 'audio-capture':
      return 'No microphone was found. Connect a mic and check Windows Settings \u2192 Privacy \u2192 Microphone, then try again.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow mic access for this site (click the padlock/mic icon in the address bar) and try again.';
    case 'network':
      return 'A network error occurred. Speech recognition needs an internet connection in most browsers.';
    default:
      return `Speech recognition error: ${code}`;
  }
}

/**
 * Wraps the Web Speech API. Emits words live (including interim results) so the
 * pace meter reacts immediately instead of waiting for final phrases.
 *
 * onResult({ newWords, interim }):
 *   newWords - array of words first recognized since the last event (live)
 *   interim  - the current in-progress (unconfirmed) text
 *
 * NOTE: This API only works over https:// or http://localhost and requires
 * microphone permission. It will not work when opening the file via file://.
 */
export function useSpeechRecognition({ onResult, lang = 'en-US' } = {}) {
  const isSupported = Boolean(SpeechRecognition);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const listeningRef = useRef(false);
  const onResultRef = useRef(onResult);
  // How many words we have already emitted in the current recognition session.
  const seenCountRef = useRef(0);

  // Keep the latest callback without re-creating recognition.
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const ensureRecognition = useCallback(() => {
    if (!isSupported) return null;
    if (recognitionRef.current) return recognitionRef.current;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = lang;

    // A fresh session (start or auto-restart) resets the result list.
    recognition.onstart = () => {
      seenCountRef.current = 0;
    };

    recognition.onresult = (event) => {
      // Build the full word list recognized so far this session, combining
      // finalized and interim results. Interim words count immediately.
      const allWords = [];
      let interim = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        text
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0)
          .forEach((w) => allWords.push(w));
        if (!result.isFinal) interim += text;
      }

      // Only the tail beyond what we've already reported is "new".
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
      // Browser stops periodically; restart while the user wants to listen.
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

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('Speech recognition error:', event.error);
      setError(describeError(event.error));
      if (event.error === 'audio-capture' || event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        listeningRef.current = false;
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [isSupported, lang]);

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

  // Clean up on unmount.
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
