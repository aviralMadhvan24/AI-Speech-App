import { useCallback, useEffect, useRef, useState } from "react";

export interface UseAudioRecorder {
  isRecording: boolean;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  reset: () => void;
  audioBlob: Blob | null;
  stream: MediaStream | null;
  error: string | null;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const candidate of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

export function useAudioRecorder(): UseAudioRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pendingStopRef = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanupStream = useCallback((target: MediaStream | null) => {
    target?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      cleanupStream(stream);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    if (isRecording) return;
    setError(null);
    setAudioBlob(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Microphone API is not available in this browser.");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        mediaStream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const finalType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalType });
        chunksRef.current = [];
        setAudioBlob(blob);
        cleanupStream(mediaStream);
        setStream(null);
        setIsRecording(false);
        const resolver = pendingStopRef.current;
        pendingStopRef.current = null;
        resolver?.(blob);
      };
      recorder.onerror = (event: Event) => {
        const message =
          (event as Event & { error?: { message?: string } }).error?.message ??
          "Recorder error";
        setError(message);
      };

      recorderRef.current = recorder;
      setStream(mediaStream);
      recorder.start(250);
      setIsRecording(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not access microphone.";
      setError(message);
      setIsRecording(false);
    }
  }, [cleanupStream, isRecording]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return audioBlob;
    }
    return await new Promise<Blob | null>((resolve) => {
      pendingStopRef.current = resolve;
      try {
        recorder.stop();
      } catch (err) {
        pendingStopRef.current = null;
        setError(err instanceof Error ? err.message : "Failed to stop recorder.");
        resolve(null);
      }
    });
  }, [audioBlob]);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setError(null);
    chunksRef.current = [];
  }, []);

  return { isRecording, start, stop, reset, audioBlob, stream, error };
}
