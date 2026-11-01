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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
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
  const meter = {
    ready: Promise.resolve(),
    setMicrophone: vi.fn(),
    setSpeaker: vi.fn(),
    setMuted: vi.fn(),
    start: vi.fn(async () => undefined),
    pause: vi.fn(),
    stop: vi.fn(async () => undefined),
  };
  let publishLevels: ((levels: { microphone: number; speaker: number }) => void) | undefined;
  const metering = vi.fn((publish: (levels: { microphone: number; speaker: number }) => void) => {
    publishLevels = publish;
    return meter;
  });
  const session = new VoiceSession({
    microphone: microphone ?? (async () => mic),
    peer: createPeer,
    audio: () => audio as unknown as HTMLAudioElement,
    open,
    metering,
  });
  return {
    session,
    mic,
    peer,
    track,
    audio,
    open,
    createPeer,
    meter,
    metering,
    publishLevels: (levels: { microphone: number; speaker: number }) => publishLevels?.(levels),
    emit: (event: ProviderVoiceSessionEvent) => onEvent?.(event),
  };
}

it.each(["ready", "stopped", "failed"] as const)(
  "prepares the thread before microphone capture: %s",
  async (outcome) => {
    const preparation = deferred<void>();
    const microphone = vi.fn<() => Promise<MediaStream>>();
    const fake = setup(microphone);
    microphone.mockResolvedValue(fake.mic);
    const prepare = vi.fn((_signal: AbortSignal) => preparation.promise);
    const starting = fake.session.start(target, prepare);
    expect(fake.session.getState().phase).toBe("connecting");
    expect(microphone).not.toHaveBeenCalled();
    if (outcome === "stopped") fake.session.stop();
    expect(prepare.mock.calls[0]?.[0].aborted).toBe(outcome === "stopped");
    if (outcome === "failed") preparation.reject(new Error("Could not prepare the workspace."));
    else preparation.resolve();
    await starting;
    expect(microphone).toHaveBeenCalledTimes(outcome === "ready" ? 1 : 0);
    if (outcome === "failed")
      expect(fake.session.getState().error).toBe("Could not prepare the workspace.");
    fake.session.stop();
  },
);

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
  expect(fake.meter.stop).toHaveBeenCalledOnce();
  const receiveLevels = vi.fn();
  const unsubscribe = fake.session.subscribeLevels(receiveLevels);
  fake.publishLevels({ microphone: 0.8, speaker: 0.9 });
  expect(receiveLevels).toHaveBeenLastCalledWith({ microphone: 0, speaker: 0 });
  unsubscribe();
});

it("publishes levels independently of conversation state and pauses metering while hidden", async () => {
  const fake = setup();
  const receiveState = vi.fn();
  const receiveLevels = vi.fn();
  const unsubscribeState = fake.session.subscribe(receiveState);
  const unsubscribeLevels = fake.session.subscribeLevels(receiveLevels);
  await fake.session.start(target);
  fake.peer.connectionState = "connected";
  fake.peer.onconnectionstatechange?.call(
    fake.peer as unknown as RTCPeerConnection,
    new Event("connectionstatechange"),
  );
  expect(fake.meter.start).toHaveBeenCalledOnce();
  receiveState.mockClear();
  fake.publishLevels({ microphone: 0.25, speaker: 0.5 });
  expect(receiveLevels).toHaveBeenLastCalledWith({ microphone: 0.25, speaker: 0.5 });
  expect(receiveState).not.toHaveBeenCalled();
  fake.session.setMeteringVisible(false);
  expect(fake.meter.pause).toHaveBeenCalledOnce();
  fake.session.setMeteringVisible(true);
  expect(fake.meter.start).toHaveBeenCalledTimes(2);
  fake.session.toggleMute();
  expect(fake.meter.setMuted).toHaveBeenLastCalledWith(true);
  fake.session.stop();
  unsubscribeLevels();
  unsubscribeState();
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

it("releases capture and surfaces metering startup failures", async () => {
  const fake = setup();
  fake.meter.ready = Promise.reject(new Error("Audio context was blocked."));
  await fake.session.start(target);
  expect(fake.session.getState()).toMatchObject({
    phase: "idle",
    error: "Audio context was blocked.",
  });
  expect(fake.track.stop).toHaveBeenCalledOnce();
  expect(fake.meter.stop).toHaveBeenCalledOnce();
  expect(fake.createPeer).not.toHaveBeenCalled();
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
    metering: fake.metering,
  });
  const first = session.start(target);
  const stalePublish = fake.metering.mock.calls[0]![0];
  const receiveLevels = vi.fn();
  const unsubscribe = session.subscribeLevels(receiveLevels);
  const next = { ...target, threadId: ThreadId.make("other-thread") };
  await session.start(next);
  permission.resolve({ getTracks: () => [staleTrack] } as unknown as MediaStream);
  await first;
  expect(staleTrack.stop).toHaveBeenCalledOnce();
  expect(fake.track.stop).not.toHaveBeenCalled();
  expect(fake.open).toHaveBeenCalledTimes(1);
  expect(session.getState().target).toEqual(next);
  stalePublish({ microphone: 1, speaker: 1 });
  expect(receiveLevels).toHaveBeenLastCalledWith({ microphone: 0, speaker: 0 });
  session.stop();
  unsubscribe();
});
