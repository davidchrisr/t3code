import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useSyncExternalStore } from "react";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { threadEnvironment } from "../state/threads";
import { VoiceSession } from "./voiceSession";

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

const stopOnPageHide = () => voiceMode.stop();
if (typeof window !== "undefined") window.addEventListener("pagehide", stopOnPageHide);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    voiceMode.stop();
    window.removeEventListener("pagehide", stopOnPageHide);
  });
