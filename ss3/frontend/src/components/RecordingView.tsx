import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Mic,
  Video,
  VideoOff,
  Square,
  ArrowLeft,
  Camera,
  Loader2,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { precheck, uploadRecording } from '../api';

interface Props {
  onUploaded: (sessionId: string) => void;
  onCancel: () => void;
}

const MIN_SEC = 30;
const MAX_SEC = 120;
const AMBER_THRESHOLD = 5;

type Phase = 'init' | 'denied' | 'ready' | 'recording' | 'uploading';

export default function RecordingView({ onUploaded, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const precheckHistoryRef = useRef<string[]>([]);

  const [phase, setPhase] = useState<Phase>('init');
  const [elapsed, setElapsed] = useState(0);
  const [readiness, setReadiness] = useState<'green' | 'amber'>('amber');
  const [guidanceVisible, setGuidanceVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Init webcam
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPhase('ready');
      } catch (err) {
        setError((err as Error).message);
        setPhase('denied');
      }
    }
    init();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        try {
          recorderRef.current.stop();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  // Precheck loop
  useEffect(() => {
    if (phase !== 'ready') return;
    let cancelled = false;
    async function tick() {
      const video = videoRef.current;
      if (!video || cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) =>
          canvas.toBlob(r, 'image/jpeg', 0.7),
        );
        if (!blob || cancelled) return;
        const result = await precheck(blob);
        if (cancelled) return;
        const indicator: 'green' | 'amber' =
          result.pose_ok && result.face_ok ? 'green' : 'amber';
        setReadiness(indicator);
        const newHistory = [...precheckHistoryRef.current, indicator].slice(-AMBER_THRESHOLD);
        precheckHistoryRef.current = newHistory;
        const allAmber =
          newHistory.length === AMBER_THRESHOLD && newHistory.every((i) => i === 'amber');
        setGuidanceVisible(allAmber);
      } catch {
        /* ignore */
      }
    }
    const interval = setInterval(tick, 1000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase]);

  // Recording timer
  useEffect(() => {
    if (phase !== 'recording') return;
    const interval = setInterval(() => {
      const t = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(t);
      if (t >= MAX_SEC) stopRecording();
    }, 250);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    chunksRef.current = [];

    let mimeType = '';
    for (const t of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(t)) {
        mimeType = t;
        break;
      }
    }

    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (err) {
      setError('MediaRecorder failed: ' + (err as Error).message);
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      setPhase('uploading');
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      try {
        const res = await uploadRecording(blob);
        onUploaded(res.session_id);
      } catch (err) {
        setError('Upload failed: ' + (err as Error).message);
        setPhase('ready');
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    startTimeRef.current = Date.now();
    setElapsed(0);
    setPhase('recording');
  }, [onUploaded]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') rec.stop();
  }, []);

  const stopEnabled = phase === 'recording' && elapsed >= MIN_SEC && elapsed < MAX_SEC;

  return (
    <div className="card-glass overflow-hidden animate-fade-in-up">
      <div className="px-6 sm:px-8 py-5 border-b border-zinc-800/60 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-zinc-50 text-lg tracking-tight">
            Record Your Practice Session
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Speak naturally. Aim for 60 to 90 seconds.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="btn-ghost text-sm"
          disabled={phase === 'uploading'}
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>

      <div className="p-6 sm:p-8">
        {/* Webcam stage */}
        <div className="relative aspect-video bg-zinc-950 rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-zinc-800 mb-5">
          {/* Subtle inner ring on focus */}
          {phase === 'recording' && (
            <div className="absolute inset-0 rounded-2xl ring-2 ring-rose-500/50 pointer-events-none z-10 animate-pulse-slow" />
          )}

          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover transform -scale-x-100"
          />

          {/* Readiness pill */}
          <div className="absolute top-4 left-4 z-10">
            <ReadinessPill state={readiness} recording={phase === 'recording'} />
          </div>

          {/* Recording timer overlay */}
          {phase === 'recording' && (
            <div className="absolute top-4 right-4 z-10 bg-rose-600 text-white px-4 py-2 rounded-xl font-mono font-bold text-lg flex items-center gap-2 shadow-glow-rose backdrop-blur-md animate-fade-in">
              <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
              {formatTime(elapsed)}
            </div>
          )}

          {/* Stage overlays */}
          {phase === 'init' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-300 gap-3 bg-zinc-950">
              <Camera className="w-12 h-12 opacity-60 animate-pulse" />
              <div className="text-sm font-medium opacity-80">Starting camera...</div>
            </div>
          )}

          {phase === 'denied' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-3 p-8 text-center bg-zinc-950">
              <VideoOff className="w-12 h-12 text-rose-400" />
              <div className="font-semibold">Camera access blocked</div>
              <div className="text-sm text-zinc-400 max-w-md">
                Allow camera and microphone permissions in your browser, then reload this page.
              </div>
            </div>
          )}

          {phase === 'uploading' && (
            <div className="absolute inset-0 bg-zinc-950/85 backdrop-blur-sm flex flex-col items-center justify-center text-zinc-100 gap-3 z-10">
              <Loader2 className="w-12 h-12 animate-spin text-brand-400" />
              <div className="font-medium">Uploading...</div>
            </div>
          )}

          {/* Subtle gradient overlay at bottom */}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
        </div>

        {/* Guidance */}
        {guidanceVisible && phase === 'ready' && (
          <div className="mb-5 flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-sm text-amber-200 animate-fade-in-up">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-amber-400" />
            <div>
              <div className="font-semibold mb-0.5">Adjust your setup</div>
              <div className="text-amber-300/80">
                Center yourself so head and shoulders are visible. Make sure the lighting
                is on your face, not behind you.
              </div>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && phase !== 'denied' && (
          <div className="mb-5 flex items-start gap-3 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-sm text-rose-200 animate-fade-in">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-rose-400" />
            <div>{error}</div>
          </div>
        )}

        {/* Progress bar (during recording) */}
        {phase === 'recording' && (
          <div className="mb-5 animate-fade-in">
            <div className="flex justify-between text-xs font-medium text-zinc-400 mb-2">
              <span className="flex items-center gap-1.5">
                {elapsed < MIN_SEC ? (
                  <>
                    <Zap className="w-3 h-3 text-amber-400" />
                    Keep going to unlock Stop...
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    You can stop anytime
                  </>
                )}
              </span>
              <span className="tabular-nums font-mono">
                {formatTime(elapsed)} / {formatTime(MAX_SEC)}
              </span>
            </div>
            <div className="h-2.5 bg-zinc-800/60 rounded-full overflow-hidden border border-zinc-800">
              <div
                className={`h-full transition-all duration-300 relative ${
                  elapsed < MIN_SEC
                    ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                    : 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                }`}
                style={{ width: `${Math.min(100, (elapsed / MAX_SEC) * 100)}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer shimmer-bg" />
              </div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-zinc-500 flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5" />
            Audio captured but not analysed in Phase 1.
          </div>
          <div className="flex items-center gap-3">
            {phase === 'recording' ? (
              <button
                onClick={stopRecording}
                disabled={!stopEnabled}
                className="btn-danger"
                title={!stopEnabled ? `Stop unlocks at ${MIN_SEC}s` : 'Stop and analyze'}
              >
                <Square className="w-4 h-4 fill-current" />
                Stop {!stopEnabled && elapsed < MIN_SEC ? `(${MIN_SEC - elapsed}s left)` : ''}
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={phase !== 'ready'}
                className="btn-primary"
              >
                <Video className="w-4 h-4" />
                Start Recording
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function ReadinessPill({ state, recording }: { state: 'green' | 'amber'; recording: boolean }) {
  if (recording) return null;
  const isGreen = state === 'green';
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md border transition-all ${
        isGreen
          ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 shadow-glow-emerald'
          : 'bg-amber-500/20 border-amber-400/50 text-amber-200'
      }`}
    >
      <span className="relative flex h-2 w-2">
        {isGreen && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            isGreen ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
          }`}
        />
      </span>
      {isGreen ? 'Ready' : 'Adjusting...'}
    </div>
  );
}
