/**
 * Recorder component (Task 11.1, Requirements 3.1, 3.2, 3.3, 3.4).
 *
 * Wraps the browser `MediaRecorder` API to let a Student record a short video
 * answer to a selected question:
 *
 *   1. Request camera + mic via `getUserMedia` (Req 3.1). Permission denial is
 *      surfaced with a clear, actionable message.
 *   2. On Start, record and run a visible countdown; auto-stop at
 *      `MAX_DURATION = 60s` (Req 3.2) — also manually stoppable.
 *   3. Assemble chunks into a Blob and preview it in a <video> (Req 3.3),
 *      with the option to discard and re-record before submitting.
 *   4. On Submit, upload the blob as multipart/form-data (field `video`) with
 *      the `questionId` to `POST /submissions` (Req 3.4).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUpload, ApiError } from '../api/client';
import type { Question, SubmissionDto } from '../api/types';

/** Maximum recording length, in seconds (Max_Duration, Req 3.2). */
export const MAX_DURATION = 60;

/** Phases of the recording lifecycle. */
type Phase = 'idle' | 'recording' | 'recorded' | 'uploading' | 'done';

export interface RecorderProps {
  /** The question being answered; its id is sent with the upload. */
  question: Question;
  /** Called after a successful upload with the created submission. */
  onSubmitted?: (submission: SubmissionDto) => void;
  /** Called when the student wants to leave the recorder / pick another question. */
  onCancel?: () => void;
}

/** Picks a MediaRecorder MIME type the browser supports, preferring WebM. */
function pickMimeType(): string | undefined {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return undefined;
  }
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Formats a second count as `m:ss`. */
function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Records, previews, and uploads a video answer to the selected question. */
export function Recorder({ question, onSubmitted, onCancel }: RecorderProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Live (camera) preview element while recording.
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  // Recorded-blob preview element after stopping.
  const playbackVideoRef = useRef<HTMLVideoElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Stops and releases the camera/mic stream. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /** Clears the running countdown interval. */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Release media + object URL on unmount.
  useEffect(() => {
    return () => {
      clearTimer();
      stopStream();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [clearTimer, stopStream, previewUrl]);

  /** Stops the in-progress recording (used by manual stop and auto-stop). */
  const stopRecording = useCallback(() => {
    clearTimer();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }, [clearTimer]);

  /** Requests camera/mic and starts recording with a 60s auto-stop timer. */
  const startRecording = useCallback(async () => {
    setError(null);
    setPermissionDenied(false);

    if (typeof MediaRecorder === 'undefined') {
      setError('Recording is not supported in this browser.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      // Permission denied or no device available — surface a clear message (Req 3.1).
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPermissionDenied(true);
        setError(
          'Camera and microphone access was blocked. Please allow access in your browser and try again.',
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError('No camera or microphone was found. Please connect one and try again.');
      } else {
        setError('Could not start recording. Please check your camera and microphone.');
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    blobRef.current = null;

    // Discard any previous preview.
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = stream;
      // Muted to avoid audio feedback while recording the live preview.
      liveVideoRef.current.muted = true;
      void liveVideoRef.current.play().catch(() => undefined);
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      blobRef.current = blob;
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      stopStream();
      setPhase('recorded');
    };

    recorder.start();
    setElapsed(0);
    setPhase('recording');

    // Visible countdown + auto-stop at MAX_DURATION (Req 3.2).
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1;
        if (next >= MAX_DURATION) {
          stopRecording();
          return MAX_DURATION;
        }
        return next;
      });
    }, 1000);
  }, [previewUrl, stopRecording, stopStream]);

  /** Discards the current recording so the student can re-record (Req 3.3). */
  const discardRecording = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    blobRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setError(null);
    setPhase('idle');
  }, [previewUrl]);

  /** Uploads the recorded blob to POST /submissions as multipart (Req 3.4). */
  const submitRecording = useCallback(async () => {
    if (!blobRef.current) {
      setError('No recording to submit. Please record an answer first.');
      return;
    }

    setPhase('uploading');
    setError(null);

    const extension = blobRef.current.type.includes('mp4') ? 'mp4' : 'webm';
    const formData = new FormData();
    formData.append('questionId', String(question.id));
    formData.append('video', blobRef.current, `answer-${question.id}.${extension}`);

    try {
      const submission = await apiUpload<SubmissionDto>('/submissions', formData);
      setPhase('done');
      onSubmitted?.(submission);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Failed to upload your recording. Please try again.',
      );
      setPhase('recorded');
    }
  }, [question.id, onSubmitted]);

  const remaining = MAX_DURATION - elapsed;

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">
            Question {question.id}
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">{question.prompt}</h3>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={() => {
              stopRecording();
              stopStream();
              onCancel();
            }}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Back
          </button>
        )}
      </header>

      <div className="overflow-hidden rounded-lg bg-slate-900">
        {/* Live camera preview while recording; recorded playback afterward. */}
        {phase === 'recorded' || phase === 'uploading' || phase === 'done' ? (
          <video
            ref={playbackVideoRef}
            src={previewUrl ?? undefined}
            controls
            className="aspect-video w-full bg-black"
          />
        ) : (
          <video
            ref={liveVideoRef}
            playsInline
            muted
            className="aspect-video w-full bg-black"
          />
        )}
      </div>

      {phase === 'recording' && (
        <div className="flex items-center justify-between rounded-md bg-red-50 px-3 py-2">
          <span className="flex items-center gap-2 text-sm font-medium text-red-700">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
            Recording…
          </span>
          <span className="font-mono text-sm tabular-nums text-red-700" aria-live="polite">
            {formatTime(remaining)} left
          </span>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {permissionDenied && (
        <p className="text-xs text-slate-500">
          Tip: click the camera icon in your browser's address bar to grant access, then press
          “Start recording” again.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {phase === 'idle' && (
          <button
            type="button"
            onClick={() => void startRecording()}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
          >
            {permissionDenied ? 'Try again' : 'Start recording'}
          </button>
        )}

        {phase === 'recording' && (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
          >
            Stop
          </button>
        )}

        {(phase === 'recorded' || phase === 'uploading') && (
          <>
            <button
              type="button"
              onClick={() => void submitRecording()}
              disabled={phase === 'uploading'}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === 'uploading' ? 'Submitting…' : 'Submit answer'}
            </button>
            <button
              type="button"
              onClick={discardRecording}
              disabled={phase === 'uploading'}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Discard & re-record
            </button>
          </>
        )}

        {phase === 'done' && (
          <div className="flex w-full flex-col gap-3">
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              Your answer was submitted and is awaiting review.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={discardRecording}
                className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark"
              >
                Record another answer
              </button>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
