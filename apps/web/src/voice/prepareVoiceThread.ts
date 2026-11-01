import {
  CommandId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { worktreeSetupAgentStarted } from "@t3tools/client-runtime/worktree-setup";
import {
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
} from "../composerDraftStore";
import { randomUUID } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { waitForThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";
import { waitForQuerySettled } from "../state/waitForQuerySettled";
import type { Thread } from "../types";

export async function prepareVoiceThread(input: {
  readonly thread: Pick<
    Thread,
    | "id"
    | "environmentId"
    | "projectId"
    | "title"
    | "createdAt"
    | "worktreePath"
    | "runtimeMode"
    | "interactionMode"
  >;
  readonly selection: {
    readonly modelSelection: ModelSelection;
    readonly runtimeMode: RuntimeMode;
    readonly interactionMode: ProviderInteractionMode;
  };
  readonly isLocalDraftThread: boolean;
  readonly needsWorktree: boolean;
  readonly branch: string | null;
  readonly startFromOrigin: boolean;
  readonly signal: AbortSignal;
  readonly isCurrentThread: () => boolean;
  readonly navigate: (ref: ScopedThreadRef) => Promise<void>;
  readonly beginWorktreeSetup: (ref: ScopedThreadRef) => void;
}) {
  const { thread, selection, signal } = input;
  const environmentId = thread.environmentId;
  const ref = scopeThreadRef(environmentId, thread.id);
  let persistedModes = { runtimeMode: thread.runtimeMode, interactionMode: thread.interactionMode };
  let persistModel = !input.isLocalDraftThread;
  const assertCurrent = () => {
    if (signal.aborted || !input.isCurrentThread())
      throw new Error("Voice startup was cancelled because the active thread changed.");
  };
  assertCurrent();
  if (input.needsWorktree && !input.branch)
    throw new Error("Select a base branch before starting voice in a new worktree.");
  if (input.isLocalDraftThread || input.needsWorktree) {
    const result = await threadEnvironment.launch.run(appAtomRegistry, {
      environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        threadId: thread.id,
        ...(input.isLocalDraftThread ? {} : { reuseExistingThread: true }),
        projectId: thread.projectId,
        title: thread.title,
        ...selection,
        workspaceStrategy: input.needsWorktree
          ? { type: "worktree", baseRef: input.branch!, startFromOrigin: input.startFromOrigin }
          : thread.worktreePath !== null
            ? {
                type: "existing_worktree",
                worktreePath: thread.worktreePath,
                ...(input.branch === null ? {} : { branch: input.branch }),
              }
            : { type: "root", ...(input.branch === null ? {} : { branch: input.branch }) },
      },
    });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    persistedModes = result.value.projection.thread;
    persistModel = !modelSelectionsEqual(
      result.value.projection.thread.modelSelection,
      selection.modelSelection,
    );
    if (input.isLocalDraftThread) {
      markPromotedDraftThreadByRef(ref);
      try {
        assertCurrent();
        if (!(await waitForThreadShell(ref)))
          throw new Error("The new thread did not appear in the client.");
        assertCurrent();
        await input.navigate(ref);
      } finally {
        finalizePromotedDraftThreadByRef(ref);
      }
    }
    assertCurrent();
    if (input.needsWorktree) {
      input.beginWorktreeSetup(ref);
      const setup = await waitForQuerySettled({
        registry: appAtomRegistry,
        atom: vcsEnvironment.worktreeSetup({ environmentId, input: { threadId: thread.id } }),
        settle: (snapshot) =>
          snapshot !== null && (snapshot.phase !== "running" || worktreeSetupAgentStarted(snapshot))
            ? snapshot
            : undefined,
        signal,
      });
      assertCurrent();
      if (
        !setup ||
        setup.phase === "failed" ||
        setup.phase === "cancelled" ||
        setup.worktreePath === null
      )
        throw new Error(setup?.error ?? "The worktree was not ready for voice.");
    }
  }
  assertCurrent();
  if (persistModel) {
    const metadata = await threadEnvironment.updateMetadata.run(appAtomRegistry, {
      environmentId,
      input: { threadId: thread.id, modelSelection: selection.modelSelection },
    });
    if (metadata._tag === "Failure") throw squashAtomCommandFailure(metadata);
    assertCurrent();
  }
  if (selection.runtimeMode !== persistedModes.runtimeMode) {
    const runtime = await threadEnvironment.setRuntimeMode.run(appAtomRegistry, {
      environmentId,
      input: {
        threadId: thread.id,
        createdAt: thread.createdAt,
        runtimeMode: selection.runtimeMode,
      },
    });
    if (runtime._tag === "Failure") throw squashAtomCommandFailure(runtime);
    assertCurrent();
  }
  if (selection.interactionMode !== persistedModes.interactionMode) {
    const interaction = await threadEnvironment.setInteractionMode.run(appAtomRegistry, {
      environmentId,
      input: {
        threadId: thread.id,
        createdAt: thread.createdAt,
        interactionMode: selection.interactionMode,
      },
    });
    if (interaction._tag === "Failure") throw squashAtomCommandFailure(interaction);
  }
  assertCurrent();
}
