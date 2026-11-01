import type { EnvironmentId, ProviderVoiceSessionEvent, ThreadId } from "@t3tools/contracts";
import type { VoiceLevels, VoiceMetering } from "./voiceMetering";

export interface VoiceTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}
export interface VoiceState {
  readonly phase: "idle" | "connecting" | "active";
  readonly target: VoiceTarget | null;
  readonly muted: boolean;
  readonly userCaption: string;
  readonly assistantCaption: string;
  readonly error: string | null;
}
interface VoicePlatform {
  readonly microphone: () => Promise<MediaStream>;
  readonly peer: () => RTCPeerConnection;
  readonly audio: () => HTMLAudioElement;
  readonly metering: (publish: (levels: VoiceLevels) => void) => VoiceMetering;
  readonly open: (
    target: VoiceTarget,
    offerSdp: string,
    signal: AbortSignal,
    onEvent: (event: ProviderVoiceSessionEvent) => void,
  ) => Promise<void>;
}
interface Owner {
  readonly abort: AbortController;
  readonly finalized: { user: boolean; assistant: boolean };
  mic?: MediaStream;
  peer?: RTCPeerConnection;
  audio?: HTMLAudioElement;
  meter?: VoiceMetering;
}

export class VoiceSession {
  private state: VoiceState = {
    phase: "idle",
    target: null,
    muted: false,
    userCaption: "",
    assistantCaption: "",
    error: null,
  };
  private owner: Owner | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly levelListeners = new Set<(levels: VoiceLevels) => void>();
  private levels: VoiceLevels = { microphone: 0, speaker: 0 };
  private meteringVisible = true;
  constructor(private readonly platform: VoicePlatform) {}
  readonly getState = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly subscribeLevels = (listener: (levels: VoiceLevels) => void) => {
    this.levelListeners.add(listener);
    listener(this.levels);
    return () => {
      this.levelListeners.delete(listener);
    };
  };
  private publishLevels(levels: VoiceLevels) {
    this.levels = levels;
    for (const listener of this.levelListeners) listener(levels);
  }
  readonly setMeteringVisible = (visible: boolean) => {
    this.meteringVisible = visible;
    const owner = this.owner;
    if (visible && this.state.phase === "active" && owner)
      void owner.meter
        ?.start()
        .catch(() => this.fail(owner, "Could not resume the voice audio meter."));
    else owner?.meter?.pause();
  };
  readonly dismissError = () => this.update({ error: null });
  private update(patch: Partial<VoiceState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  readonly stop = () => {
    const owner = this.owner;
    this.owner = undefined;
    owner?.abort.abort();
    for (const track of owner?.mic?.getTracks() ?? []) track.stop();
    owner?.peer?.close();
    if (owner?.audio) {
      owner.audio.pause();
      owner.audio.srcObject = null;
    }
    this.update({ phase: "idle", muted: false });
    this.publishLevels({ microphone: 0, speaker: 0 });
    const stoppedState = this.state;
    void owner?.meter?.stop().catch(() => {
      if (this.state === stoppedState)
        this.update({ error: "Could not release the voice audio meter." });
    });
  };
  readonly toggleMute = () => {
    if (!this.owner) return;
    const muted = !this.state.muted;
    for (const track of this.owner.mic?.getAudioTracks() ?? []) track.enabled = !muted;
    this.owner.meter?.setMuted(muted);
    this.update({ muted });
  };
  private fail(owner: Owner, message: string) {
    if (this.owner !== owner) return;
    this.stop();
    this.update({ error: message });
  }
  readonly start = async (target: VoiceTarget) => {
    this.stop();
    const owner: Owner = {
      abort: new AbortController(),
      finalized: { user: false, assistant: false },
    };
    this.owner = owner;
    this.update({
      phase: "connecting",
      target,
      userCaption: "",
      assistantCaption: "",
      error: null,
    });
    try {
      const meter = this.platform.metering((levels) => {
        if (this.owner === owner) this.publishLevels(levels);
      });
      owner.meter = meter;
      const meterReady = meter.ready.then(
        () => null,
        (cause: unknown) =>
          cause instanceof Error ? cause : new Error("Could not start the voice audio meter."),
      );
      const mic = await this.platform.microphone();
      if (this.owner !== owner) {
        for (const track of mic.getTracks()) track.stop();
        return;
      }
      owner.mic = mic;
      for (const track of mic.getAudioTracks()) track.enabled = !this.state.muted;
      meter.setMicrophone(mic);
      meter.setMuted(this.state.muted);
      const meterError = await meterReady;
      if (this.owner !== owner) return;
      if (meterError) throw meterError;
      const peer = this.platform.peer();
      owner.peer = peer;
      const audio = this.platform.audio();
      owner.audio = audio;
      audio.autoplay = true;
      peer.ontrack = (event) => {
        if (this.owner !== owner) return;
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        try {
          meter.setSpeaker(stream);
        } catch {
          this.fail(owner, "Could not connect the speaker audio meter.");
          return;
        }
        audio.srcObject = stream;
        void audio
          .play()
          .catch(() =>
            this.fail(owner, "Audio playback was blocked. Start voice again to allow playback."),
          );
      };
      peer.onconnectionstatechange = () => {
        if (this.owner !== owner) return;
        if (peer.connectionState === "connected") {
          this.update({ phase: "active" });
          if (this.meteringVisible)
            void meter
              .start()
              .catch(() => this.fail(owner, "Could not start the voice audio meter."));
        }
        if (["failed", "disconnected", "closed"].includes(peer.connectionState))
          this.fail(owner, "The voice connection ended. Start voice again to reconnect.");
      };
      for (const track of mic.getAudioTracks()) {
        peer.addTrack(track, mic);
        track.addEventListener(
          "ended",
          () => {
            if (this.owner === owner) this.stop();
          },
          { once: true },
        );
      }
      peer.createDataChannel("oai-events", { ordered: true });
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIce(peer, owner.abort.signal);
      if (this.owner !== owner) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("The browser could not create the voice connection.");
      void this.platform
        .open(target, sdp, owner.abort.signal, (event) => {
          if (this.owner !== owner) return;
          if (event.type === "answer") {
            void peer
              .setRemoteDescription({ type: "answer", sdp: event.sdp })
              .catch(() => this.fail(owner, "The voice connection could not be negotiated."));
          } else if (event.type === "closed") {
            this.stop();
          } else if (event.type === "speech.failed") {
            this.update({
              error:
                event.reason === "too-long"
                  ? "The coding answer is too long to speak. Read it in the thread."
                  : "Could not speak the coding answer. Read it in the thread.",
            });
          } else if (event.type === "transcript.delta" || event.type === "transcript.done") {
            const key = event.role === "user" ? "userCaption" : "assistantCaption";
            this.update({
              [key]: (event.type === "transcript.delta" && !owner.finalized[event.role]
                ? this.state[key] + event.text
                : event.text
              ).slice(-8192),
            });
            owner.finalized[event.role] = event.type === "transcript.done";
          }
        })
        .then(
          () => {
            if (this.owner === owner) this.stop();
          },
          (cause: unknown) => {
            this.fail(
              owner,
              cause instanceof Error ? cause.message : "The voice session ended unexpectedly.",
            );
          },
        );
    } catch (cause) {
      this.fail(owner, cause instanceof Error ? cause.message : "Could not start voice.");
    }
  };
}

function waitForIce(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("Voice was stopped."));
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener("icegatheringstatechange", changed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const changed = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
    const aborted = () => finish(new Error("Voice was stopped."));
    const timer = setTimeout(() => finish(new Error("Voice connection setup timed out.")), 20_000);
    peer.addEventListener("icegatheringstatechange", changed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else changed();
  });
}
