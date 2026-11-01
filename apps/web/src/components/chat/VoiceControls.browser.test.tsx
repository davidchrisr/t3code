import { EnvironmentId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { voiceMode } from "../../voice/voiceMode";
import { BackgroundThreadContext } from "./backgroundThread";
import { useVoiceControls } from "./VoiceControls";

vi.mock(import("../../state/threads"), async () => {
  const { Atom } = await import("effect/reactivity");
  const permitted = Atom.make(true);
  return {
    threadEnvironment: {
      voiceSession: { permissionAtom: () => permitted },
    } as never,
  };
});

vi.mock(import("../../voice/voiceMetering"), () => ({
  createVoiceMetering: () => ({
    ready: Promise.resolve(),
    setMicrophone: () => {},
    setSpeaker: () => {},
    setMuted: () => {},
    start: async () => {},
    pause: () => {},
    stop: async () => {},
  }),
}));

function Composer({ id }: { id: string }) {
  const { toggleVoice } = useVoiceControls({
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make(id),
    provider: ProviderDriverKind.make("codex"),
    canOperateThread: true,
    unavailableReason: null,
    thread: null,
    keybindings: [
      {
        command: "voice.toggle",
        shortcut: {
          key: "f7",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: false,
        },
      },
      {
        command: "voice.toggleMute",
        shortcut: {
          key: "f9",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: false,
        },
      },
    ],
  });
  return <button onClick={toggleVoice}>Voice for {id}</button>;
}

function Composers({ background = false }: { background?: boolean }) {
  return (
    <AppAtomRegistryProvider>
      <BackgroundThreadContext value={background}>
        <Composer id="main" />
      </BackgroundThreadContext>
      <BackgroundThreadContext value>
        <Composer id="side" />
      </BackgroundThreadContext>
    </AppAtomRegistryProvider>
  );
}

function setup() {
  voiceMode.stop();
  voiceMode.dismissError();
  return { [Symbol.dispose]: () => voiceMode.stop() };
}

it("gives only the foreground composer global voice shortcuts while keeping side-chat buttons usable", async () => {
  using _fixture = setup();
  await using screen = await render(<Composers />);
  // Keep capture pending so this checks session ownership without opening a microphone or transport.
  using _microphone = vi
    .spyOn(navigator.mediaDevices, "getUserMedia")
    .mockImplementation(() => new Promise<MediaStream>(() => {}));

  await userEvent.keyboard("{F7}");
  expect(voiceMode.getState()).toMatchObject({
    phase: "connecting",
    target: { threadId: "main" },
  });

  await userEvent.keyboard("{F7}");
  expect(voiceMode.getState().phase).toBe("idle");

  await screen.rerender(<Composers background />);
  await userEvent.keyboard("{F7}");
  expect(voiceMode.getState().phase).toBe("idle");

  await userEvent.click(screen.getByRole("button", { name: "Voice for side" }));
  expect(voiceMode.getState()).toMatchObject({
    phase: "connecting",
    target: { threadId: "side" },
  });
  await screen.rerender(<Composers />);
  await userEvent.keyboard("{F9}");
  expect(voiceMode.getState()).toMatchObject({
    phase: "connecting",
    target: { threadId: "side" },
    muted: true,
  });

  await userEvent.keyboard("{F9}");
  expect(voiceMode.getState().muted).toBe(false);

  await userEvent.keyboard("{F7}");
  expect(voiceMode.getState()).toMatchObject({
    phase: "idle",
    target: { threadId: "side" },
  });
});
