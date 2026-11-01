import { expect, it } from "vite-plus/test";
import { ProviderDriverKind } from "@t3tools/contracts";
import { isVoiceCommand, resolveVoiceAvailability } from "./voiceAvailability";

const ready = {
  provider: ProviderDriverKind.make("codex"),
  hasSession: true,
  permitted: true,
  browserSupported: true,
  microphoneAvailable: true,
  unavailableReason: null,
};

it.each([
  [{ provider: ProviderDriverKind.make("claude") }, { kind: "unsupported" }],
  [{ hasSession: false }, { kind: "unavailable", reason: "Send a message before starting voice." }],
  [
    { permitted: false },
    { kind: "unavailable", reason: "You do not have permission to start voice." },
  ],
  [
    { browserSupported: false },
    { kind: "unavailable", reason: "This browser does not support voice conversations." },
  ],
  [
    { microphoneAvailable: false },
    { kind: "unavailable", reason: "Microphone access requires HTTPS or localhost." },
  ],
  [
    { unavailableReason: "Environment disconnected." },
    { kind: "unavailable", reason: "Environment disconnected." },
  ],
  [{}, { kind: "ready" }],
])("resolves voice availability for %j", (overrides, expected) => {
  expect(resolveVoiceAvailability({ ...ready, ...overrides })).toEqual(expected);
});

it.each([
  ["/voice", true],
  ["  /VOICE\n", true],
  ["/voice explain this", false],
  ["please /voice", false],
  ["/voices", false],
])("recognizes standalone voice commands in %j", (prompt, expected) => {
  expect(isVoiceCommand(prompt)).toBe(expected);
});
