import {
  MessageId,
  type CodexSettings,
  ProviderDriverKind,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2AppThread,
  type ProviderVoiceSessionEvent,
} from "@t3tools/contracts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import type { ProviderContinuationRequest } from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import type * as CodexClient from "effect-codex-app-server/client";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Cause from "effect/Cause";

export function readVoiceHandoff(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null || Reflect.get(item, "type") !== "userMessage")
    return undefined;
  const entries: unknown = Reflect.get(item, "content");
  if (!Array.isArray(entries) || entries.length !== 1) return undefined;
  const content: unknown = entries[0];
  if (typeof content !== "object" || content === null || Reflect.get(content, "type") !== "text")
    return undefined;
  const text: unknown = Reflect.get(content, "text");
  if (typeof text !== "string") return undefined;
  const match =
    /^\s*<realtime_delegation>[\s\S]*?<input>([\s\S]*?)<\/input>[\s\S]*<\/realtime_delegation>\s*$/.exec(
      text,
    );
  return (
    match?.[1]?.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").trim() ||
    undefined
  );
}

export const makeCodexVoice = Effect.fn("CodexVoice.make")(function* (
  client: CodexClient.CodexAppServerClient["Service"],
  offerContinuation: (request: ProviderContinuationRequest) => Effect.Effect<void>,
) {
  type Active = {
    readonly threadSettings: Pick<
      OrchestrationV2AppThread,
      "modelSelection" | "runtimeMode" | "interactionMode"
    >;
    readonly providerThread: OrchestrationV2ProviderThread;
    readonly sessionId: string;
    readonly queue: Queue.Queue<
      ProviderVoiceSessionEvent,
      ProviderAdapter.ProviderAdapterProtocolError | Cause.Done
    >;
    ordinal: number;
    closed: boolean;
  };
  let active: Active | undefined;
  const failure = (cause: unknown) =>
    new ProviderAdapter.ProviderAdapterProtocolError({
      driver: ProviderDriverKind.make("codex"),
      detail: "Voice conversation failed.",
      cause,
    });
  // Caption events are frequent and already belong to the provider session's trace.
  const notify = Effect.fnUntraced(function* (threadId: string, event: ProviderVoiceSessionEvent) {
    const owner = active;
    if (!owner || owner.closed || owner.providerThread.nativeThreadRef?.nativeId !== threadId)
      return;
    if (event.type === "transcript.done" && event.text.trim() !== "") {
      yield* offerContinuation({
        threadId: owner.providerThread.appThreadId!,
        providerThreadId: owner.providerThread.id,
        driver: ProviderDriverKind.make("codex"),
        detail: event.text,
        messageId: MessageId.make(`voice:${owner.sessionId}:${owner.ordinal++}`),
        voice: { type: "transcript", role: event.role },
        onVoiceFailure: Queue.fail(owner.queue, failure(undefined)).pipe(Effect.asVoid),
      });
    }
    yield* Queue.offer(owner.queue, event);
    if (event.type === "closed") {
      owner.closed = true;
      yield* Queue.end(owner.queue);
    }
  });
  yield* client.handleServerNotification("thread/realtime/started", (p) =>
    notify(p.threadId, { type: "started" }),
  );
  yield* client.handleServerNotification("thread/realtime/sdp", (p) =>
    notify(p.threadId, { type: "answer", sdp: p.sdp }),
  );
  yield* client.handleServerNotification("thread/realtime/transcript/delta", (p) =>
    notify(p.threadId, {
      type: "transcript.delta",
      role: p.role === "user" ? "user" : "assistant",
      text: p.delta,
    }),
  );
  yield* client.handleServerNotification("thread/realtime/transcript/done", (p) =>
    notify(p.threadId, {
      type: "transcript.done",
      role: p.role === "user" ? "user" : "assistant",
      text: p.text,
    }),
  );
  yield* client.handleServerNotification("thread/realtime/closed", (p) =>
    notify(p.threadId, { type: "closed" }),
  );
  yield* client.handleServerNotification("thread/realtime/error", (p) =>
    Effect.suspend(() => {
      const owner = active;
      if (!owner || owner.providerThread.nativeThreadRef?.nativeId !== p.threadId)
        return Effect.void;
      return Queue.fail(owner.queue, failure(undefined)).pipe(Effect.asVoid);
    }),
  );

  return {
    current: () => {
      const owner = active;
      return owner === undefined || owner.closed
        ? undefined
        : {
            providerThread: owner.providerThread,
            threadSettings: owner.threadSettings,
            sessionId: owner.sessionId,
            fail: Queue.fail(owner.queue, failure(undefined)).pipe(Effect.asVoid),
          };
    },
    ownsThread: (threadId: string) =>
      active !== undefined &&
      !active.closed &&
      active.providerThread.nativeThreadRef?.nativeId === threadId,
    start: (input: {
      readonly providerThread: OrchestrationV2ProviderThread;
      readonly offerSdp: string;
      readonly voice?: CodexSettings["voice"];
      readonly threadSettings: Active["threadSettings"];
    }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          if (active !== undefined)
            return yield* failure("A voice conversation is already active.");
          const threadId = input.providerThread.nativeThreadRef?.nativeId;
          if (!threadId || input.providerThread.appThreadId === null)
            return yield* failure("No active thread.");
          const owner: Active = {
            threadSettings: input.threadSettings,
            providerThread: input.providerThread,
            sessionId: yield* randomUuidV4,
            queue: yield* Queue.dropping<
              ProviderVoiceSessionEvent,
              ProviderAdapter.ProviderAdapterProtocolError | Cause.Done
            >(128),
            ordinal: 0,
            closed: false,
          };
          // Reserve before any request yields; a second start cannot replace this owner.
          if (active !== undefined)
            return yield* failure("A voice conversation is already active.");
          active = owner;
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              if (active !== owner) return;
              owner.closed = true;
              yield* client.raw.request("thread/realtime/stop", { threadId }).pipe(
                Effect.timeoutOption("5 seconds"),
                Effect.andThen((result) =>
                  Option.isNone(result)
                    ? Effect.logWarning("codex.voice.stop-timeout")
                    : Effect.void,
                ),
                Effect.ignore,
                Effect.ensuring(
                  Effect.gen(function* () {
                    if (active === owner) active = undefined;
                    yield* Queue.end(owner.queue);
                  }),
                ),
              );
            }),
          );
          yield* client.raw
            .request("thread/realtime/start", {
              threadId,
              outputModality: "audio",
              transport: { type: "webrtc", sdp: input.offerSdp },
              version: "v3",
              clientManagedHandoffs: true,
              includeStartupContext: true,
              ...(input.voice ? { voice: input.voice } : {}),
            })
            .pipe(Effect.mapError(failure));
          return Stream.fromQueue(owner.queue);
        }),
      ),
    speak: Effect.fn("CodexVoice.speak")(function* (
      threadId: string,
      text: string,
      sessionId: string,
    ) {
      const owner = active;
      if (
        !owner ||
        owner.closed ||
        owner.sessionId !== sessionId ||
        owner.providerThread.nativeThreadRef?.nativeId !== threadId
      )
        return;
      if (text.length > 3900) {
        yield* Queue.offer(owner.queue, { type: "speech.failed", reason: "too-long" });
        return;
      }
      yield* client.raw
        .request("thread/realtime/appendSpeech", { threadId, text })
        .pipe(
          Effect.catch(() =>
            Queue.offer(owner.queue, { type: "speech.failed", reason: "provider" }),
          ),
        );
    }),
  };
});
