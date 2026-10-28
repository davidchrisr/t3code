import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  OrchestrationV2Command,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { historicalMessage } from "@t3tools/provider-core/server/handoffBudget";
import * as ProviderContinuationRequests from "@t3tools/provider-core/server/ProviderContinuationRequests";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const isClientCommand = Schema.is(OrchestrationV2Command);
const modelSelection = { instanceId, model: "gpt-5.4" };
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Voice persistence tests must not launch a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const database = SqlitePersistence.layerMemory;
const layer = Layer.mergeAll(
  database,
  ProviderContinuationRequests.layer,
  ProjectionStore.layer.pipe(Layer.provide(database)),
  EffectOutbox.layer.pipe(Layer.provide(database)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "voice-orchestration" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: database, runEffectWorker: false, runContinuationWorker: true },
  ),
);

const createThread = Effect.fn("VoiceTest.createThread")(function* (threadId: ThreadId) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId: ProjectId.make("voice-project"),
    title: "Voice",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
});

it.effect(
  "persists voice dialogue once without creating work or duplicating provider context",
  () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("voice-dialogue");
      yield* createThread(threadId);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const outbox = yield* EffectOutbox.EffectOutboxV2;
      const command = {
        type: "voice.transcript.record" as const,
        commandId: CommandId.make("record-voice"),
        threadId,
        messageId: MessageId.make("voice-caption"),
        role: "user" as const,
        text: "Let's discuss the login page first.",
      };
      yield* orchestrator.dispatch(command);
      yield* orchestrator.dispatch(command);
      const projection = yield* projections.getThreadProjection(threadId);
      assert.lengthOf(projection.runs, 0);
      assert.lengthOf(projection.messages, 1);
      assert.equal(projection.messages[0]?.voiceTranscript, true);
      assert.deepEqual(yield* outbox.listByCommandId(command.commandId), []);
      const history = yield* projections.getTimelinePage(threadId, { limit: 20, view: "messages" });
      assert.lengthOf(history.items, 1);
      assert.equal(
        "voiceTranscript" in history.items[0]!.item && history.items[0]!.item.voiceTranscript,
        true,
      );
      assert.isNull(historicalMessage(history.items[0]!.item));
      assert.isFalse(isClientCommand(command));
    }).pipe(Effect.provide(layer)),
);

it.effect("records a voice terminal failure once without dispatching more work", () =>
  Effect.gen(function* () {
    const threadId = ThreadId.make("voice-early-terminal");
    yield* createThread(threadId);
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const outbox = yield* EffectOutbox.EffectOutboxV2;
    const command = {
      type: "voice.failure.record" as const,
      commandId: CommandId.make("voice:voice-failure:native-turn"),
      threadId,
      messageId: MessageId.make("voice-failure:native-turn"),
    };
    assert.isFalse(isClientCommand(command));
    const sink = yield* EventSink.EventSinkV2;
    const requests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
    const afterSequence = yield* sink.latestSequence({ threadId });
    const recorded = yield* sink.stream({ threadId, afterSequence }).pipe(
      Stream.filter(
        ({ event }) => event.type === "turn-item.updated" && event.payload.type === "error",
      ),
      Stream.runHead,
      Effect.forkScoped,
    );
    yield* requests.offer({
      threadId,
      providerThreadId: ProviderThreadId.make("early-native-thread"),
      driver: ProviderDriverKind.make("codex"),
      detail: null,
      messageId: command.messageId,
      voice: { type: "failure" },
    });
    yield* Fiber.join(recorded);
    yield* orchestrator.dispatch(command);
    const projection = yield* projections.getThreadProjection(threadId);
    assert.lengthOf(projection.runs, 0);
    assert.lengthOf(projection.messages, 0);
    assert.lengthOf(projection.turnItems, 1);
    assert.equal(projection.turnItems[0]?.type, "error");
    assert.deepEqual(yield* outbox.listByCommandId(command.commandId), []);
  }).pipe(Effect.provide(layer)),
);

it.effect.each(["completed", "failed", "usage_limit"] as const)(
  "records native adoption after %s without releasing typed holds",
  (outcome) =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("voice-coding");
      yield* createThread(threadId);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("initial-run"),
        threadId,
        messageId: MessageId.make("initial-message"),
        text: "Hello",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      const initial = yield* projections.getThreadProjection(threadId);
      const providerThread = initial.providerThreads[0]!;
      const now = yield* DateTime.now;
      yield* projections.apply({
        id: EventId.make("voice-native-ref"),
        type: "provider-thread.updated",
        threadId,
        occurredAt: now,
        payload: {
          ...providerThread,
          nativeThreadRef: {
            driver: ProviderDriverKind.make("codex"),
            nativeId: "codex-thread",
            strength: "strong",
          },
        },
      });
      yield* projections.apply({
        id: EventId.make("voice-active-thread"),
        type: "thread.metadata-updated",
        threadId,
        occurredAt: now,
        payload: { ...initial.thread, activeProviderThreadId: providerThread.id },
      });
      yield* projections.apply({
        id: EventId.make("voice-initial-finished"),
        type: "run.updated",
        threadId,
        occurredAt: now,
        payload: { ...initial.runs[0]!, status: "completed", completedAt: now },
      });
      const command = {
        type: "voice.handoff" as const,
        modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        commandId: CommandId.make("adopt-voice"),
        threadId,
        providerThreadId: providerThread.id,
        nativeTurnId: "codex-voice-turn",
        messageId: MessageId.make("voice-request"),
        text: "Fix the login page",
      };
      yield* orchestrator.dispatch(command);
      yield* orchestrator.dispatch(command);
      const projection = yield* projections.getThreadProjection(threadId);
      assert.lengthOf(projection.runs, 2);
      assert.equal(projection.runs[1]?.adoptedNativeTurnId, command.nativeTurnId);
      assert.equal(projection.runs[1]?.providerThreadId, providerThread.id);
      assert.isFalse(isClientCommand(command));
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("queued-typed-work"),
        threadId,
        messageId: MessageId.make("queued-typed-message"),
        text: "Do this later",
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "user",
        creationSource: "web",
      });
      const queued = (yield* projections.getThreadProjection(threadId)).runs[2]!;
      yield* projections.apply({
        id: EventId.make("hold-typed-work"),
        type: "run.updated",
        threadId,
        occurredAt: now,
        payload: { ...queued, queueHeld: true },
      });
      yield* orchestrator.dispatch({
        ...command,
        commandId: CommandId.make("second-voice-adoption"),
        nativeTurnId: "second-native-turn",
        messageId: MessageId.make("second-voice-request"),
      });
      const afterQueuedVoice = yield* projections.getThreadProjection(threadId);
      assert.isFalse(afterQueuedVoice.runs[3]?.queueHeld === true);
      assert.equal(afterQueuedVoice.runs[3]?.queuePosition, 1);
      assert.isFalse(yield* projections.canStartQueuedRun(threadId));
      if (outcome === "completed") {
        yield* projections.apply({
          id: EventId.make("voice-first-completed"),
          type: "run.updated",
          threadId,
          occurredAt: now,
          payload: { ...afterQueuedVoice.runs[1]!, status: "completed", completedAt: now },
        });
        assert.isTrue(yield* projections.canStartQueuedRun(threadId));
        yield* orchestrator.resumeQueuedRuns;
      } else {
        const sink = yield* EventSink.EventSinkV2;
        const afterSequence = yield* sink.latestSequence({ threadId });
        const promoted = yield* sink.stream({ threadId, afterSequence }).pipe(
          Stream.filter(
            ({ event }) =>
              event.type === "run.updated" && event.payload.id === afterQueuedVoice.runs[3]!.id,
          ),
          Stream.runHead,
          Effect.forkScoped,
        );
        const failed = afterQueuedVoice.runs[1]!;
        yield* sink.write({
          events: [
            {
              id: EventId.make("voice-prior-error"),
              type: "turn-item.updated",
              threadId,
              occurredAt: now,
              payload: {
                id: TurnItemId.make("voice-prior-error"),
                threadId,
                runId: failed.id,
                nodeId: failed.rootNodeId,
                providerThreadId: failed.providerThreadId,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal: 200,
                status: "failed",
                title: null,
                startedAt: now,
                completedAt: now,
                updatedAt: now,
                type: "error",
                failure: {
                  class: outcome === "usage_limit" ? "usage_limit" : "provider_error",
                  message: "Previous native turn failed.",
                  code: null,
                  retryable: null,
                },
              },
            },
            {
              id: EventId.make("voice-prior-failed"),
              type: "run.updated",
              threadId,
              occurredAt: now,
              payload: { ...failed, status: "failed", completedAt: now },
            },
          ],
        });
        const promotedEvent = Option.getOrThrow(yield* Fiber.join(promoted)).event;
        assert.equal(
          promotedEvent.type === "run.updated" && promotedEvent.payload.status,
          "starting",
        );
      }
      const adopted = yield* projections.getThreadProjection(threadId);
      assert.equal(adopted.runs[3]?.status, "starting");
      assert.equal(adopted.runs[2]?.status, "queued");
      assert.isTrue(adopted.runs[2]?.queueHeld);
      yield* orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("voice-policy-change"),
        threadId,
        runtimeMode: "approval-required",
      });
      const rejected = yield* orchestrator
        .dispatch({
          ...command,
          commandId: CommandId.make("stale-voice-handoff"),
          nativeTurnId: "stale-turn",
          messageId: MessageId.make("stale-voice-message"),
        })
        .pipe(Effect.result);
      assert.equal(rejected._tag, "Failure");
      assert.lengthOf((yield* projections.getThreadProjection(threadId)).runs, 4);
    }).pipe(Effect.provide(layer)),
);
