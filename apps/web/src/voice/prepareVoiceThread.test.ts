import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type WorktreeSetupSnapshot,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { threadEnvironment } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";
import { waitForThreadShell } from "../state/entities";
import { prepareVoiceThread } from "./prepareVoiceThread";
import { makeThreadProjectionFixture } from "../test-fixtures";

vi.mock(import("../state/threads"), () => ({
  threadEnvironment: {
    launch: { run: vi.fn() },
    updateMetadata: { run: vi.fn() },
    setRuntimeMode: { run: vi.fn() },
    setInteractionMode: { run: vi.fn() },
  } as never,
}));
vi.mock(import("../state/entities"), () => ({ waitForThreadShell: vi.fn() }));
vi.mock(import("../state/vcs"), () => ({
  vcsEnvironment: { worktreeSetup: vi.fn() } as never,
}));
vi.mock(import("../composerDraftStore"), () => ({
  markPromotedDraftThreadByRef: vi.fn(),
  finalizePromotedDraftThreadByRef: vi.fn(),
}));
vi.mock(import("../lib/utils"), () => ({ randomUUID: () => "voice-start-command" }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  vi.clearAllMocks();
  const thread = {
    id: ThreadId.make("voice-thread"),
    environmentId: EnvironmentId.make("voice-environment"),
    projectId: ProjectId.make("voice-project"),
    title: "New thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    worktreePath: null,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
  };
  const stored = {
    modelSelection: {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-haiku-4-5",
    } as ModelSelection,
    runtimeMode: thread.runtimeMode as RuntimeMode,
    interactionMode: thread.interactionMode as ProviderInteractionMode,
  };
  const baseProjection = makeThreadProjectionFixture();
  const projection = {
    ...baseProjection,
    thread: { ...baseProjection.thread, id: thread.id, ...stored },
  };
  const launchResult = { threadId: thread.id, projection, resumed: false };
  vi.mocked(threadEnvironment.launch.run).mockResolvedValue(AsyncResult.success(launchResult));
  vi.mocked(threadEnvironment.updateMetadata.run).mockImplementation(
    async (_registry, { input }) => {
      if (input.modelSelection) stored.modelSelection = input.modelSelection;
      return AsyncResult.success({ sequence: 1 });
    },
  );
  vi.mocked(threadEnvironment.setRuntimeMode.run).mockImplementation(
    async (_registry, { input }) => {
      stored.runtimeMode = input.runtimeMode;
      return AsyncResult.success({ sequence: 1 });
    },
  );
  vi.mocked(threadEnvironment.setInteractionMode.run).mockImplementation(
    async (_registry, { input }) => {
      stored.interactionMode = input.interactionMode;
      return AsyncResult.success({ sequence: 1 });
    },
  );
  vi.mocked(waitForThreadShell).mockResolvedValue(true);
  const snapshot = {
    threadId: thread.id,
    phase: "done",
    startedAt: thread.createdAt,
    endedAt: thread.createdAt,
    branch: "voice-worktree",
    baseRef: "main",
    worktreePath: "/voice-worktree",
    setupScript: null,
    stages: [],
    error: null,
    sequence: 1,
  } satisfies WorktreeSetupSnapshot;
  vi.mocked(vcsEnvironment.worktreeSetup).mockReturnValue(Atom.make(AsyncResult.success(snapshot)));
  const controller = new AbortController();
  const input = {
    thread,
    selection: {
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-luna" },
      runtimeMode: "approval-required",
      interactionMode: "plan",
    },
    isLocalDraftThread: false,
    needsWorktree: true,
    branch: "main",
    startFromOrigin: false,
    signal: controller.signal,
    isCurrentThread: vi.fn<() => boolean>().mockReturnValue(true),
    navigate: vi.fn(async () => {}),
    beginWorktreeSetup: vi.fn(),
  } satisfies Parameters<typeof prepareVoiceThread>[0];
  return { input, stored, controller, launchResult };
}

it("uses the selected provider and modes when an existing empty thread prepares a worktree", async () => {
  const { input, stored } = setup();
  await prepareVoiceThread(input);
  expect(stored).toEqual(input.selection);
});

it.each(["same-model", "different-model"] as const)(
  "reconciles a restarted draft's selection when launch reuses an earlier request (%s)",
  async (scenario) => {
    const { input, stored, controller, launchResult } = setup();
    stored.modelSelection =
      scenario === "same-model"
        ? input.selection.modelSelection
        : { ...input.selection.modelSelection, model: "original-model" };
    const queuedLaunch = {
      ...launchResult,
      projection: {
        ...launchResult.projection,
        thread: { ...launchResult.projection.thread, modelSelection: stored.modelSelection },
      },
    };
    const launching = deferred();
    const finishLaunch = deferred();
    const launch = finishLaunch.promise.then(() => AsyncResult.success(queuedLaunch));
    vi.mocked(threadEnvironment.launch.run).mockImplementation(() => {
      launching.resolve();
      return launch;
    });
    const earlier = prepareVoiceThread({
      ...input,
      isLocalDraftThread: true,
      needsWorktree: false,
      selection: {
        modelSelection: stored.modelSelection,
        runtimeMode: stored.runtimeMode,
        interactionMode: stored.interactionMode,
      },
    });
    const cancelled = expect(earlier).rejects.toThrow("cancelled");
    await launching.promise;
    controller.abort();
    const restarted = prepareVoiceThread({
      ...input,
      isLocalDraftThread: true,
      needsWorktree: false,
      thread: {
        ...input.thread,
        runtimeMode: input.selection.runtimeMode,
        interactionMode: input.selection.interactionMode,
      },
      signal: new AbortController().signal,
    });
    finishLaunch.resolve();
    await cancelled;
    await restarted;
    expect(stored).toEqual(input.selection);
  },
);

it.each(["stop", "navigation"] as const)(
  "does not attach worktree UI after %s during launch",
  async (reason) => {
    const { input, stored, controller, launchResult } = setup();
    const launching = deferred();
    const finishLaunch = deferred();
    vi.mocked(threadEnvironment.launch.run).mockImplementation(async () => {
      launching.resolve();
      await finishLaunch.promise;
      return AsyncResult.success(launchResult);
    });
    const pending = prepareVoiceThread(input);
    await launching.promise;
    if (reason === "stop") controller.abort();
    else input.isCurrentThread.mockReturnValue(false);
    finishLaunch.resolve();
    await expect(pending).rejects.toThrow("cancelled");
    expect(input.beginWorktreeSetup).not.toHaveBeenCalled();
    expect(stored.modelSelection.instanceId).toBe("claudeAgent");
  },
);

it.each(["metadata", "shell", "navigation"] as const)(
  "cancels preparation before further mutations after awaiting %s",
  async (stage) => {
    const { input, stored, controller } = setup();
    const paused = deferred();
    const resume = deferred();
    const pause = async () => {
      paused.resolve();
      await resume.promise;
    };
    const preparing = {
      ...input,
      isLocalDraftThread: stage !== "metadata",
      needsWorktree: stage !== "metadata",
    };
    if (stage === "metadata") {
      vi.mocked(threadEnvironment.updateMetadata.run).mockImplementation(async () => {
        await pause();
        return AsyncResult.success({ sequence: 1 });
      });
    } else if (stage === "shell") {
      vi.mocked(waitForThreadShell).mockImplementation(async () => {
        await pause();
        return true;
      });
    } else preparing.navigate = vi.fn(pause);
    const pending = prepareVoiceThread(preparing);
    await paused.promise;
    controller.abort();
    resume.resolve();
    await expect(pending).rejects.toThrow("cancelled");
    expect(input.beginWorktreeSetup).not.toHaveBeenCalled();
    expect(stored.runtimeMode).toBe("full-access");
    expect(stored.interactionMode).toBe("default");
  },
);
