export interface VoiceLevels {
  readonly microphone: number;
  readonly speaker: number;
}

export interface VoiceMetering {
  readonly ready: Promise<void>;
  readonly setMicrophone: (stream: MediaStream) => void;
  readonly setSpeaker: (stream: MediaStream) => void;
  readonly setMuted: (muted: boolean) => void;
  readonly start: () => Promise<void>;
  readonly pause: () => void;
  readonly stop: () => Promise<void>;
}

export function createVoiceMetering(
  publish: (levels: VoiceLevels) => void,
  context = new AudioContext(),
): VoiceMetering {
  const microphone = context.createAnalyser();
  const speaker = context.createAnalyser();
  microphone.fftSize = 512;
  speaker.fftSize = 512;
  const microphoneSamples = new Float32Array(512);
  const speakerSamples = new Float32Array(512);
  let microphoneSource: MediaStreamAudioSourceNode | undefined;
  let speakerSource: MediaStreamAudioSourceNode | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let generation = 0;
  let muted = false;
  let levels: VoiceLevels = { microphone: 0, speaker: 0 };
  const sample = () => {
    levels = {
      microphone: muted || !microphoneSource ? 0 : readLevel(microphone, microphoneSamples),
      speaker: speakerSource ? readLevel(speaker, speakerSamples) : 0,
    };
    publish(levels);
  };
  const pause = () => {
    generation++;
    clearInterval(timer);
    timer = undefined;
  };
  return {
    ready: context.resume(),
    setMicrophone: (stream) => {
      if (stopped) return;
      microphoneSource?.disconnect();
      microphoneSource = context.createMediaStreamSource(stream);
      // Analyser outputs stay disconnected so metering never plays microphone audio.
      microphoneSource.connect(microphone);
    },
    setSpeaker: (stream) => {
      if (stopped) return;
      speakerSource?.disconnect();
      speakerSource = context.createMediaStreamSource(stream);
      speakerSource.connect(speaker);
    },
    setMuted: (value) => {
      muted = value;
      if (muted) {
        levels = { ...levels, microphone: 0 };
        publish(levels);
      }
    },
    start: async () => {
      if (stopped || timer !== undefined) return;
      const startingGeneration = ++generation;
      await context.resume();
      if (stopped || startingGeneration !== generation) return;
      sample();
      timer = setInterval(sample, 100);
    },
    pause,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      pause();
      microphoneSource?.disconnect();
      speakerSource?.disconnect();
      await context.close();
    },
  };
}

function readLevel(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(samples);
  let energy = 0;
  for (const value of samples) energy += value * value;
  return Math.min(1, Math.sqrt(energy / samples.length));
}
