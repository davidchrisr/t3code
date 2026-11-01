import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useSyncExternalStore } from "react";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { threadEnvironment } from "../state/threads";
import { VoiceSession } from "./voiceSession";
import type { VoiceState, VoiceTarget } from "./voiceSession";
import { createVoiceMetering } from "./voiceMetering";
import type { VoiceAvailability } from "./voiceAvailability";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { toastManager } from "../components/ui/toast";

export const voiceMode = new VoiceSession({
  microphone: () => {
    if (!navigator.mediaDevices?.getUserMedia)
      return Promise.reject(
        new Error(
          "Voice needs microphone access. Open the app over HTTPS when connecting remotely.",
        ),
      );
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  },
  peer: () => new RTCPeerConnection(),
  audio: () => new Audio(),
  metering: createVoiceMetering,
  open: async (target, offerSdp, signal, onEvent) => {
    const result = await threadEnvironment.voiceSession.run(appAtomRegistry, {
      environmentId: target.environmentId,
      input: { payload: { threadId: target.threadId, offerSdp }, signal, onEvent },
    });
    if (result._tag === "Failure" && !signal.aborted) {
      const error = squashAtomCommandFailure(result);
      throw new Error(
        error instanceof Error ? error.message : "Could not start the voice session.",
      );
    }
  },
});

export function useVoiceState() {
  return useSyncExternalStore(voiceMode.subscribe, voiceMode.getState, voiceMode.getState);
}

export function isVoiceTargetFor(state: VoiceState, target: VoiceTarget | null): boolean {
  return (
    target !== null &&
    state.target?.environmentId === target.environmentId &&
    state.target.threadId === target.threadId
  );
}

export function useVoicePhaseFor(environmentId: EnvironmentId, threadId: ThreadId | null) {
  const getPhase = () => {
    const state = voiceMode.getState();
    return threadId !== null && isVoiceTargetFor(state, { environmentId, threadId })
      ? state.phase
      : "idle";
  };
  return useSyncExternalStore(voiceMode.subscribe, getPhase, getPhase);
}

export function toggleThreadVoice(
  target: VoiceTarget | null,
  availability: VoiceAvailability,
): boolean {
  const state = voiceMode.getState();
  if (state.phase !== "idle" && isVoiceTargetFor(state, target)) {
    voiceMode.stop();
    return true;
  }
  if (availability.kind !== "ready" || target === null) {
    toastManager.add({
      type: "info",
      title:
        availability.kind === "unavailable"
          ? availability.reason
          : "Voice conversations are available in Codex threads.",
    });
    return false;
  }
  void voiceMode.start(target);
  return true;
}

const stopOnPageHide = () => voiceMode.stop();
const updateMeteringVisibility = () =>
  voiceMode.setMeteringVisible(document.visibilityState === "visible");
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", stopOnPageHide);
  document.addEventListener("visibilitychange", updateMeteringVisibility);
  updateMeteringVisibility();
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    voiceMode.stop();
    window.removeEventListener("pagehide", stopOnPageHide);
    document.removeEventListener("visibilitychange", updateMeteringVisibility);
  });
