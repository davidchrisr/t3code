import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId, type ProviderVoiceSessionEvent } from "@t3tools/contracts";
import { VoiceSession } from "./voiceSession";

const target = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};

it.each(["too-long", "provider"] as const)(
  "shows a %s speech failure while keeping voice connected",
  async (reason) => {
    const fake = setup();
    await fake.session.start(target);
    fake.emit({ type: "speech.failed", reason });
    expect(fake.session.getState().error).toContain("Read it in the thread.");
    expect(fake.session.getState().phase).toBe("connecting");
    expect(fake.track.stop).not.toHaveBeenCalled();
    fake.session.stop();
  },
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function setup(microphone?: () => Promise<MediaStream>) {
  const track = { enabled: true, stop: vi.fn(), addEventListener: vi.fn() };
  const mic = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const peer = {
    connectionState: "new",
    iceGatheringState: "complete",
    localDescription: { type: "offer", sdp: "offer-sdp" },
    ontrack: null as RTCPeerConnection["ontrack"],
    onconnectionstatechange: null as RTCPeerConnection["onconnectionstatechange"],
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    addTrack: vi.fn(),
    createDataChannel: vi.fn(),
    close: vi.fn(),
  };
  const audio = {
    autoplay: false,
    srcObject: null,
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
  };
  let onEvent: ((event: ProviderVoiceSessionEvent) => void) | undefined;
  const open = vi.fn(
    (_target, _sdp, signal: AbortSignal, event: (event: ProviderVoiceSessionEvent) => void) => {
      onEvent = event;
      return new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  );
  const createPeer = vi.fn(() => peer as unknown as RTCPeerConnection);
  const session = new VoiceSession({
    microphone: microphone ?? (async () => mic),
    peer: createPeer,
    audio: () => audio as unknown as HTMLAudioElement,
    open,
  });
  return {
    session,
    mic,
    peer,
    track,
    audio,
    open,
    createPeer,
    emit: (event: ProviderVoiceSessionEvent) => onEvent?.(event),
  };
}

it("releases a microphone permission result that arrives after Stop", async () => {
  const permission = deferred<MediaStream>();
  const fake = setup(() => permission.promise);
  const starting = fake.session.start(target);
  fake.session.stop();
  permission.resolve(fake.mic);
  await starting;
  expect(fake.track.stop).toHaveBeenCalledOnce();
  expect(fake.createPeer).not.toHaveBeenCalled();
  expect(fake.open).not.toHaveBeenCalled();
  expect(fake.session.getState().phase).toBe("idle");
});

it("sends only the offer through T3 and releases capture, playback, and the stream on Stop", async () => {
  const fake = setup();
  await fake.session.start(target);
  expect(fake.open).toHaveBeenCalledWith(
    target,
    "offer-sdp",
    expect.any(AbortSignal),
    expect.any(Function),
  );
  fake.emit({ type: "answer", sdp: "answer-sdp" });
  expect(fake.peer.setRemoteDescription).toHaveBeenCalledWith({
    type: "answer",
    sdp: "answer-sdp",
  });
  fake.session.toggleMute();
  expect(fake.track.enabled).toBe(false);
  expect(fake.track.stop).not.toHaveBeenCalled();
  fake.session.toggleMute();
  expect(fake.track.enabled).toBe(true);
  const signal = fake.open.mock.calls[0]![2];
  fake.session.stop();
  expect(signal.aborted).toBe(true);
  expect(fake.track.stop).toHaveBeenCalledOnce();
  expect(fake.peer.close).toHaveBeenCalledOnce();
  expect(fake.audio.pause).toHaveBeenCalledOnce();
  expect(fake.audio.srcObject).toBeNull();
});

it("honors mute while microphone permission is still pending", async () => {
  const permission = deferred<MediaStream>();
  const fake = setup(() => permission.promise);
  const starting = fake.session.start(target);
  fake.session.toggleMute();
  permission.resolve(fake.mic);
  await starting;
  expect(fake.track.enabled).toBe(false);
  expect(fake.session.getState().muted).toBe(true);
  fake.session.stop();
});

it("ends local capture when the server closes the voice session", async () => {
  const fake = setup();
  await fake.session.start(target);
  fake.emit({ type: "transcript.done", role: "user", text: "hello" });
  expect(fake.session.getState().userCaption).toBe("hello");
  fake.emit({ type: "closed" });
  expect(fake.session.getState().phase).toBe("idle");
  expect(fake.track.stop).toHaveBeenCalledOnce();
  expect(fake.peer.close).toHaveBeenCalledOnce();
});

it("does not let a stale permission result replace the new conversation", async () => {
  const permission = deferred<MediaStream>();
  const fake = setup();
  const staleTrack = { stop: vi.fn() };
  const microphone = vi
    .fn()
    .mockImplementationOnce(() => permission.promise)
    .mockResolvedValue(fake.mic);
  const session = new VoiceSession({
    microphone,
    peer: () => fake.peer as unknown as RTCPeerConnection,
    audio: () => fake.audio as unknown as HTMLAudioElement,
    open: fake.open,
  });
  const first = session.start(target);
  const next = { ...target, threadId: ThreadId.make("other-thread") };
  await session.start(next);
  permission.resolve({ getTracks: () => [staleTrack] } as unknown as MediaStream);
  await first;
  expect(staleTrack.stop).toHaveBeenCalledOnce();
  expect(fake.track.stop).not.toHaveBeenCalled();
  expect(fake.open).toHaveBeenCalledTimes(1);
  expect(session.getState().target).toEqual(next);
  session.stop();
});
