import { expect, it, vi } from "vite-plus/test";
import { createVoiceMetering } from "./voiceMetering";

it("samples both streams, silences mute, and releases its timer and audio graph", async () => {
  vi.useFakeTimers();
  try {
    const microphone = {
      fftSize: 0,
      getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.25),
    };
    const speaker = {
      fftSize: 0,
      getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.5),
    };
    const sources = [
      { connect: vi.fn(), disconnect: vi.fn() },
      { connect: vi.fn(), disconnect: vi.fn() },
    ];
    const context = {
      resume: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      createAnalyser: vi.fn().mockReturnValueOnce(microphone).mockReturnValueOnce(speaker),
      createMediaStreamSource: vi
        .fn()
        .mockReturnValueOnce(sources[0])
        .mockReturnValueOnce(sources[1]),
    };
    const publish = vi.fn();
    const meter = createVoiceMetering(publish, context as unknown as AudioContext);
    await meter.ready;
    meter.setMicrophone({} as MediaStream);
    meter.setSpeaker({} as MediaStream);
    await meter.start();
    expect(publish).toHaveBeenLastCalledWith({ microphone: 0.25, speaker: 0.5 });
    meter.setMuted(true);
    expect(publish).toHaveBeenLastCalledWith({ microphone: 0, speaker: 0.5 });
    meter.setMuted(false);
    vi.advanceTimersByTime(100);
    expect(publish).toHaveBeenLastCalledWith({ microphone: 0.25, speaker: 0.5 });
    meter.pause();
    publish.mockClear();
    vi.advanceTimersByTime(500);
    expect(publish).not.toHaveBeenCalled();
    let finishResume!: () => void;
    context.resume.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishResume = resolve;
      });
      return undefined;
    });
    const resuming = meter.start();
    meter.pause();
    finishResume();
    await resuming;
    expect(vi.getTimerCount()).toBe(0);
    await meter.start();
    expect(publish).toHaveBeenCalledOnce();
    await meter.stop();
    expect(sources[0]?.disconnect).toHaveBeenCalledOnce();
    expect(sources[1]?.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await meter.start();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
