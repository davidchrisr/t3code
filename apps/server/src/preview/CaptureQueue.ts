// @effect-diagnostics globalTimers:off - CDP callbacks run outside the Effect runtime.
import { constVoid } from "effect/Function";

export class CaptureQueue {
  private tail: Promise<void> = Promise.resolve();

  run<A>(
    operation: (signal: AbortSignal) => Promise<A>,
    timeoutMs: number | undefined,
    timeoutError: (started: boolean) => Error,
  ): Promise<A> {
    const previous = this.tail;
    const controller = new AbortController();
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      if (timeoutMs === undefined) return;
      timer = setTimeout(() => {
        const error = timeoutError(started);
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    const pending = previous.then(() => {
      controller.signal.throwIfAborted();
      started = true;
      return operation(controller.signal);
    });
    const result = Promise.race([pending, expired]).finally(() => clearTimeout(timer));
    // Expired waiters retain their place until the preceding capture releases it.
    this.tail = Promise.all([previous, result.then(constVoid, constVoid)]).then(constVoid);
    return result;
  }
}
