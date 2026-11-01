import { isProviderNativeSubagentThread, type ProviderDriverKind } from "@t3tools/contracts";
import type { Thread } from "../types";

export type VoiceAvailability =
  | { readonly kind: "unsupported" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "ready" };

export function resolveVoiceAvailability(input: {
  readonly provider: ProviderDriverKind | undefined;
  readonly hasThread: boolean;
  readonly permitted: boolean;
  readonly browserSupported: boolean;
  readonly microphoneAvailable: boolean;
  readonly unavailableReason: string | null;
  readonly thread?: Pick<Thread, "source" | "archivedAt" | "deletedAt"> | null;
}): VoiceAvailability {
  if (input.provider !== "codex") return { kind: "unsupported" };
  const reason =
    input.unavailableReason ??
    (input.thread?.archivedAt != null || input.thread?.deletedAt != null
      ? "Reopen this thread before starting voice."
      : null) ??
    (input.thread && isProviderNativeSubagentThread(input.thread.source)
      ? "Voice is unavailable in provider subagent threads."
      : null) ??
    (!input.permitted ? "You do not have permission to start voice." : null) ??
    (!input.browserSupported ? "This browser does not support voice conversations." : null) ??
    (!input.microphoneAvailable ? "Microphone access requires HTTPS or localhost." : null) ??
    (!input.hasThread ? "Select a thread before starting voice." : null);
  return reason === null ? { kind: "ready" } : { kind: "unavailable", reason };
}

export function isVoiceCommand(prompt: string): boolean {
  return /^\/voice$/i.test(prompt.trim());
}

export function voiceBrowserSupport() {
  return {
    browserSupported:
      typeof RTCPeerConnection !== "undefined" && typeof AudioContext !== "undefined",
    microphoneAvailable:
      typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia !== undefined,
  };
}
