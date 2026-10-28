import { assert, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderThreadId,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import type * as CodexClient from "effect-codex-app-server/client";
import type { ProviderContinuationRequest } from "@t3tools/provider-core/server/ProviderContinuationRequests";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { makeCodexVoice, readVoiceHandoff } from "./CodexVoice.ts";

const providerThread: OrchestrationV2ProviderThread = {
  id: ProviderThreadId.make("voice-thread"),
  driver: ProviderDriverKind.make("codex"),
  providerInstanceId: ProviderInstanceId.make("codex"),
  providerSessionId: ProviderSessionId.make("session"),
  appThreadId: ThreadId.make("thread"),
  ownerNodeId: null,
  nativeThreadRef: {
    driver: ProviderDriverKind.make("codex"),
    nativeId: "native-thread",
    strength: "strong",
  },
  nativeConversationHeadRef: null,
  status: "active",
  firstRunOrdinal: 1,
  lastRunOrdinal: 1,
  handoffIds: [],
  forkedFrom: null,
  createdAt: DateTime.makeUnsafe(0),
  updatedAt: DateTime.makeUnsafe(0),
};
const threadSettings = {
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
};

const setup = Effect.gen(function* () {
  const behavior = { failSpeech: false, holdStop: false };
  const handlers = new Map<string, (payload: unknown) => Effect.Effect<void>>();
  const calls: Array<{ method: string; params: unknown }> = [];
  const persisted: ProviderContinuationRequest[] = [];
  const started = yield* Deferred.make<void>();
  const secondStarted = yield* Deferred.make<void>();
  const releaseStart = yield* Deferred.make<void>();
  const stopping = yield* Deferred.make<void>();
  const releaseStop = yield* Deferred.make<void>();
  const client = {
    handleServerNotification: (
      method: string,
      handler: (payload: unknown) => Effect.Effect<void>,
    ) =>
      Effect.sync(() => {
        handlers.set(method, handler);
      }),
    raw: {
      request: (method: string, params: unknown) =>
        Effect.gen(function* () {
          calls.push({ method, params });
          if (method === "thread/realtime/stop" && behavior.holdStop) {
            yield* Deferred.succeed(stopping, undefined);
            yield* Deferred.await(releaseStop);
          }
          if (method === "thread/realtime/appendSpeech" && behavior.failSpeech)
            return yield* new ProviderAdapter.ProviderAdapterProtocolError({
              driver: ProviderDriverKind.make("codex"),
              detail: "Speech rejected.",
            });
          if (method === "thread/realtime/start") {
            yield* Deferred.succeed(started, undefined);
            if (calls.filter((call) => call.method === method).length === 2)
              yield* Deferred.succeed(secondStarted, undefined);
            yield* Deferred.await(releaseStart);
          }
          return {};
        }),
    },
  } as unknown as CodexClient.CodexAppServerClient["Service"];
  const voice = yield* makeCodexVoice(client, (request) =>
    Effect.sync(() => {
      persisted.push(request);
    }),
  );
  return {
    behavior,
    voice,
    calls,
    persisted,
    started,
    secondStarted,
    releaseStart,
    stopping,
    releaseStop,
    emit: (method: string, payload: unknown) => handlers.get(method)?.(payload) ?? Effect.void,
  };
});

it.effect.each([undefined, "", "maple"] as const)("starts with the selected voice %s", (selected) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* setup;
      const fiber = yield* fake.voice
        .start({
          providerThread,
          threadSettings,
          offerSdp: "offer",
          ...(selected === undefined ? {} : { voice: selected }),
        })
        .pipe(Stream.runDrain, Effect.forkScoped);
      yield* Deferred.await(fake.started);
      assert.deepEqual(fake.calls.find((call) => call.method === "thread/realtime/start")?.params, {
        threadId: "native-thread",
        outputModality: "audio",
        transport: { type: "webrtc", sdp: "offer" },
        version: "v3",
        clientManagedHandoffs: true,
        includeStartupContext: true,
        ...(selected ? { voice: selected } : {}),
      });
      yield* Fiber.interrupt(fiber);
    }),
  ),
);

it.effect("rejects an overlapping start while the first backend request is pending", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* setup;
      const first = yield* fake.voice
        .start({ providerThread, threadSettings, offerSdp: "offer" })
        .pipe(Stream.runDrain, Effect.forkScoped);
      yield* Deferred.await(fake.started);
      const second = yield* fake.voice
        .start({ providerThread, threadSettings, offerSdp: "another-offer" })
        .pipe(Stream.runDrain, Effect.result);
      assert.equal(second._tag, "Failure");
      assert.equal(fake.calls.filter((call) => call.method === "thread/realtime/start").length, 1);
      yield* Fiber.interrupt(first);
      assert.equal(fake.calls.filter((call) => call.method === "thread/realtime/stop").length, 1);
    }),
  ),
);

it.effect("releases voice ownership when native stop never responds", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* setup;
      fake.behavior.holdStop = true;
      yield* Deferred.succeed(fake.releaseStart, undefined);
      const voice = yield* fake.voice
        .start({ providerThread, threadSettings, offerSdp: "offer" })
        .pipe(Stream.runDrain, Effect.forkScoped);
      yield* Deferred.await(fake.started);
      const stopped = yield* Deferred.make<void>();
      const stopping = yield* Fiber.interrupt(voice).pipe(
        Effect.ensuring(Deferred.succeed(stopped, undefined)),
        Effect.forkScoped,
      );
      yield* Deferred.await(fake.stopping);
      yield* TestClock.adjust("5 seconds");
      const ended = yield* Deferred.isDone(stopped);
      yield* Deferred.succeed(fake.releaseStop, undefined);
      yield* Fiber.join(stopping);
      assert.isTrue(ended);
      fake.behavior.holdStop = false;
      const next = yield* fake.voice
        .start({ providerThread, threadSettings, offerSdp: "next" })
        .pipe(Stream.runDrain, Effect.forkScoped);
      yield* Deferred.await(fake.secondStarted);
      yield* Fiber.interrupt(next);
    }),
  ),
);

it.effect(
  "saves only finalized captions and keeps transcripts from separate sessions distinct",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* setup;
        yield* Deferred.succeed(fake.releaseStart, undefined);
        const first = yield* fake.voice
          .start({ providerThread, threadSettings, offerSdp: "offer" })
          .pipe(Stream.runDrain, Effect.forkScoped);
        yield* Deferred.await(fake.started);
        yield* fake.emit("thread/realtime/transcript/delta", {
          threadId: "native-thread",
          role: "user",
          delta: "hello",
        });
        assert.lengthOf(fake.persisted, 0);
        yield* fake.emit("thread/realtime/transcript/done", {
          threadId: "another-thread",
          role: "user",
          text: "private",
        });
        assert.lengthOf(fake.persisted, 0);
        yield* fake.emit("thread/realtime/transcript/done", {
          threadId: "native-thread",
          role: "user",
          text: "hello",
        });
        assert.equal(fake.persisted[0]?.detail, "hello");
        assert.deepEqual(fake.persisted[0]?.voice, { type: "transcript", role: "user" });
        yield* Fiber.interrupt(first);
        const second = yield* fake.voice
          .start({ providerThread, threadSettings, offerSdp: "offer-2" })
          .pipe(Stream.runDrain, Effect.forkScoped);
        yield* Deferred.await(fake.secondStarted);
        yield* fake.emit("thread/realtime/transcript/done", {
          threadId: "native-thread",
          role: "assistant",
          text: "hello back",
        });
        yield* Fiber.interrupt(second);
        assert.lengthOf(fake.persisted, 2);
        assert.notEqual(fake.persisted[0]?.messageId, fake.persisted[1]?.messageId);
        assert.isFalse(fake.voice.ownsThread("native-thread"));
      }),
    ),
);

it.effect("isolates delayed coding results and failures from the next voice session", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fake = yield* setup;
      yield* Deferred.succeed(fake.releaseStart, undefined);
      const first = yield* fake.voice
        .start({ providerThread, threadSettings, offerSdp: "offer" })
        .pipe(Stream.runDrain, Effect.forkScoped);
      yield* Deferred.await(fake.started);
      const oldOwner = fake.voice.current()!;
      yield* Fiber.interrupt(first);
      const second = yield* fake.voice
        .start({ providerThread, threadSettings, offerSdp: "offer-2" })
        .pipe(Stream.runDrain, Effect.forkScoped);
      yield* Deferred.await(fake.secondStarted);
      yield* oldOwner.fail;
      yield* fake.voice.speak("native-thread", "old result", oldOwner.sessionId);
      assert.lengthOf(
        fake.calls.filter((call) => call.method === "thread/realtime/appendSpeech"),
        0,
      );
      assert.isTrue(fake.voice.ownsThread("native-thread"));
      yield* fake.voice.speak("native-thread", "current result", fake.voice.current()!.sessionId);
      assert.lengthOf(
        fake.calls.filter((call) => call.method === "thread/realtime/appendSpeech"),
        1,
      );
      yield* Fiber.interrupt(second);
    }),
  ),
);

it("recognizes a single native delegation without treating ordinary text as a handoff", () => {
  assert.equal(
    readVoiceHandoff({
      type: "userMessage",
      content: [
        {
          type: "text",
          text: "<realtime_delegation><input>Fix A &amp; B</input></realtime_delegation>",
        },
      ],
    }),
    "Fix A & B",
  );
  assert.isUndefined(
    readVoiceHandoff({
      type: "userMessage",
      content: [{ type: "text", text: "Please explain <input>this</input>" }],
    }),
  );
});

it.effect.each(["oversized", "provider-error"] as const)(
  "reports %s speech delivery failures to the voice client",
  (scenario) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* setup;
        yield* Deferred.succeed(fake.releaseStart, undefined);
        const voice = yield* fake.voice
          .start({ providerThread, threadSettings, offerSdp: "offer" })
          .pipe(Stream.runCollect, Effect.forkScoped);
        yield* Deferred.await(fake.started);
        fake.behavior.failSpeech = scenario === "provider-error";
        const result = yield* fake.voice
          .speak(
            "native-thread",
            scenario === "oversized" ? "x".repeat(3901) : "answer",
            fake.voice.current()!.sessionId,
          )
          .pipe(Effect.result);
        assert.isTrue(fake.voice.ownsThread("native-thread"));
        yield* fake.emit("thread/realtime/closed", { threadId: "native-thread" });
        const events = Array.from(yield* Fiber.join(voice));
        assert.equal(result._tag, "Success");
        assert.deepEqual(events, [
          { type: "speech.failed", reason: scenario === "oversized" ? "too-long" : "provider" },
          { type: "closed" },
        ]);
      }),
    ),
);
