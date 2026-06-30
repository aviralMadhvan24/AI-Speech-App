import { useEffect, useRef, useState } from "react";

/**
 * Reads byte-frequency data from a MediaStream's AnalyserNode and returns
 * an array of smoothed bar heights in the range 0..1.
 * When the stream is null, returns zeroed bars and tears down resources.
 */
export function useAudioVisualizer(
  stream: MediaStream | null,
  bars: number = 7,
): number[] {
  const [levels, setLevels] = useState<number[]>(() => new Array(bars).fill(0));
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const smoothedRef = useRef<number[]>(new Array(bars).fill(0));

  useEffect(() => {
    smoothedRef.current = new Array(bars).fill(0);
    setLevels(new Array(bars).fill(0));
  }, [bars]);

  useEffect(() => {
    if (!stream) return;

    const AudioContextClass: typeof AudioContext | undefined =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        : undefined;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;

    let source: MediaStreamAudioSourceNode | null = null;
    try {
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch {
      // Stream might not be audio-capable; bail.
      context.close().catch(() => {});
      return;
    }

    ctxRef.current = context;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const bucketSize = Math.max(1, Math.floor(buffer.length / bars));

    const tick = () => {
      analyser.getByteFrequencyData(buffer);
      const next = new Array(bars).fill(0);
      for (let b = 0; b < bars; b += 1) {
        let sum = 0;
        const startIndex = b * bucketSize;
        const endIndex = Math.min(buffer.length, startIndex + bucketSize);
        for (let i = startIndex; i < endIndex; i += 1) {
          sum += buffer[i] ?? 0;
        }
        const avg = sum / Math.max(1, endIndex - startIndex);
        const normalized = Math.min(1, Math.pow(avg / 255, 0.7));
        const previous = smoothedRef.current[b] ?? 0;
        // EMA smoothing for a fluid visual.
        const blended = previous * 0.55 + normalized * 0.45;
        smoothedRef.current[b] = blended;
        next[b] = blended;
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        sourceRef.current?.disconnect();
      } catch {
        // ignore
      }
      try {
        analyserRef.current?.disconnect();
      } catch {
        // ignore
      }
      ctxRef.current?.close().catch(() => {});
      sourceRef.current = null;
      analyserRef.current = null;
      ctxRef.current = null;
      smoothedRef.current = new Array(bars).fill(0);
      setLevels(new Array(bars).fill(0));
    };
  }, [stream, bars]);

  return levels;
}
