/**
 * Hook for Daily.co live audio in GD rooms.
 * Handles joining/leaving audio rooms and managing local audio.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DailyIframe, { DailyCall, DailyParticipant } from "@daily-co/daily-js";

interface UseDailyAudioOptions {
  roomUrl: string | null;
  userName: string;
  enabled: boolean;
}

interface DailyAudioState {
  isJoined: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  error: string | null;
  participants: DailyParticipant[];
  activeSpeaker: string | null;
}

export function useDailyAudio({ roomUrl, userName, enabled }: UseDailyAudioOptions) {
  const callRef = useRef<DailyCall | null>(null);
  const [state, setState] = useState<DailyAudioState>({
    isJoined: false,
    isConnecting: false,
    isMuted: false,
    error: null,
    participants: [],
    activeSpeaker: null,
  });

  // Join the Daily room
  const join = useCallback(async () => {
    if (!roomUrl || !enabled || callRef.current) return;

    setState((s) => ({ ...s, isConnecting: true, error: null }));

    try {
      // Create Daily call object
      const call = DailyIframe.createCallObject({
        audioSource: true,
        videoSource: false, // Audio only
      });

      callRef.current = call;

      // Set up event listeners
      call.on("joined-meeting", () => {
        setState((s) => ({ ...s, isJoined: true, isConnecting: false }));
      });

      call.on("left-meeting", () => {
        setState((s) => ({
          ...s,
          isJoined: false,
          isConnecting: false,
          participants: [],
          activeSpeaker: null,
        }));
      });

      call.on("participant-joined", (event) => {
        if (event?.participant) {
          setState((s) => ({
            ...s,
            participants: [...s.participants, event.participant],
          }));
        }
      });

      call.on("participant-left", (event) => {
        if (event?.participant) {
          setState((s) => ({
            ...s,
            participants: s.participants.filter(
              (p) => p.session_id !== event.participant.session_id
            ),
          }));
        }
      });

      call.on("participant-updated", (event) => {
        if (event?.participant) {
          setState((s) => ({
            ...s,
            participants: s.participants.map((p) =>
              p.session_id === event.participant.session_id ? event.participant : p
            ),
          }));
        }
      });

      call.on("active-speaker-change", (event) => {
        setState((s) => ({
          ...s,
          activeSpeaker: event?.activeSpeaker?.peerId || null,
        }));
      });

      call.on("error", (event) => {
        console.error("Daily error:", event);
        setState((s) => ({
          ...s,
          error: event?.errorMsg || "Audio connection error",
          isConnecting: false,
        }));
      });

      // Join the room
      await call.join({
        url: roomUrl,
        userName: userName,
        startVideoOff: true,
        startAudioOff: false,
      });
    } catch (err) {
      console.error("Failed to join Daily room:", err);
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "Failed to join audio",
        isConnecting: false,
      }));
      callRef.current = null;
    }
  }, [roomUrl, userName, enabled]);

  // Leave the Daily room
  const leave = useCallback(async () => {
    if (callRef.current) {
      try {
        await callRef.current.leave();
        await callRef.current.destroy();
      } catch (err) {
        console.warn("Error leaving Daily room:", err);
      }
      callRef.current = null;
      setState((s) => ({
        ...s,
        isJoined: false,
        isConnecting: false,
        participants: [],
        activeSpeaker: null,
      }));
    }
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (callRef.current) {
      const newMuted = !state.isMuted;
      callRef.current.setLocalAudio(!newMuted);
      setState((s) => ({ ...s, isMuted: newMuted }));
    }
  }, [state.isMuted]);

  // Auto-join when roomUrl becomes available and enabled
  useEffect(() => {
    if (roomUrl && enabled && !state.isJoined && !state.isConnecting) {
      void join();
    }
  }, [roomUrl, enabled, state.isJoined, state.isConnecting, join]);

  // Auto-leave when disabled or roomUrl changes
  useEffect(() => {
    if (!enabled || !roomUrl) {
      void leave();
    }
  }, [enabled, roomUrl, leave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (callRef.current) {
        void callRef.current.leave().catch(() => {});
        void callRef.current.destroy().catch(() => {});
        callRef.current = null;
      }
    };
  }, []);

  return {
    ...state,
    join,
    leave,
    toggleMute,
  };
}
