import { useAtomValue } from "@effect/atom-react";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  createComposerPublisher,
  createComposerStorageAtoms,
} from "@t3tools/client-runtime/state/composer-storage";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type ComposerStoredPrompt, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useComposerDraftStore, type ComposerThreadDraftState } from "../../composerDraftStore";
import { getClientId } from "../../lib/backgroundActivityReporter";
import { readAttachmentUpload, useAttachmentUploadStore } from "../../lib/attachmentUploadQueue";
import {
  previewAnnotationContextRecord,
  reviewCommentContextRecord,
  terminalContextRecord,
} from "../../lib/composerContextRecords";
import { usePromptStashStore } from "../../promptStashStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentSession } from "../../state/session";
import { environmentPresentations } from "../../state/presentation";
import { createComposerDraftChanges } from "./composerSharing.logic";

export const composerStorage = createComposerStorageAtoms(connectionAtomRuntime);
const useSharingStatus = create<{ errors: Readonly<Record<string, string | null>> }>(() => ({
  errors: {},
}));
const reportTargetsAtom = Atom.make((get) => {
  const targets = new Map<EnvironmentId, PreparedConnection>();
  for (const environmentId of get(environmentPresentations.serverConfigsAtom).keys()) {
    if (!get(composerStorage.publish.permissionAtom(environmentId))) continue;
    const connection = get(environmentSession.preparedConnectionValueAtom(environmentId));
    if (Option.isSome(connection)) targets.set(environmentId, connection.value);
  }
  return targets;
}).pipe(Atom.withLabel("composer-sharing-targets"));

function draftEntry(
  threadId: ThreadId,
  environmentId: EnvironmentId,
  draft: ComposerThreadDraftState,
): ComposerStoredPrompt {
  const files: NonNullable<ComposerStoredPrompt["files"]>[number][] = [];
  const inlineImages = new Map(draft.persistedAttachments.map((image) => [image.id, image]));
  for (const file of [...draft.images, ...draft.files]) {
    const upload = readAttachmentUpload(file.id);
    const persisted =
      "uploadedAttachmentId" in file && file.uploadEnvironmentId === environmentId
        ? file.uploadedAttachmentId
        : undefined;
    const attachmentId =
      persisted ??
      (upload?.status === "ready" && upload.environmentId === environmentId
        ? upload.attachmentId
        : undefined);
    if (attachmentId === undefined) {
      if (file.type === "image" && inlineImages.has(file.id)) continue;
      throw new Error("This draft will be shared after its attachments finish uploading.");
    }
    inlineImages.delete(file.id);
    files.push({
      id: file.id,
      type: file.type,
      attachmentId,
      environmentId,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      ...(file.type === "image"
        ? file.source === undefined
          ? {}
          : { imageSource: file.source }
        : { source: file.source }),
    });
  }
  return {
    id: threadId,
    createdAt: "1970-01-01T00:00:00.000Z",
    prompt: draft.prompt,
    attachments: [...inlineImages.values()],
    files,
    droppedImageNames: [],
    records: [
      ...(draft.replyTo === null ? [] : [draft.replyTo]),
      ...draft.threadContexts,
      ...draft.environmentContexts,
      ...draft.terminalContexts.map(terminalContextRecord),
      ...draft.reviewComments.map(reviewCommentContextRecord),
      ...draft.previewAnnotations.map((annotation) =>
        previewAnnotationContextRecord(annotation, {
          screenshotContextId: draft.images.some((image) => image.id === annotation.id)
            ? annotation.id
            : undefined,
        }),
      ),
    ],
  };
}

function makePublisher(environmentId: EnvironmentId) {
  const setError = (message: string | null) =>
    useSharingStatus.setState((state) => ({
      errors: { ...state.errors, [environmentId]: message },
    }));
  return createComposerPublisher({
    publish: async (input) => {
      const result = await runAtomCommand(
        appAtomRegistry,
        composerStorage.publish,
        { environmentId, input },
        { reportFailure: false },
      );
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    },
    onError: (error) =>
      setError(error instanceof Error ? error.message : "Could not share this client's prompts."),
    onSuccess: () => setError(null),
  });
}

export function startComposerSharing(): () => void {
  const clientId = getClientId();
  const os = /iPad/.test(navigator.userAgent)
    ? "iPad"
    : /iPhone/.test(navigator.userAgent)
      ? "iPhone"
      : /Mac/.test(navigator.userAgent)
        ? "Mac"
        : /Android/.test(navigator.userAgent)
          ? "Android"
          : /Windows/.test(navigator.userAgent)
            ? "Windows"
            : "Linux";
  const clientName = window.desktopBridge
    ? `${os} desktop`
    : `${os} · ${/Firefox/.test(navigator.userAgent) ? "Firefox" : /Edg\//.test(navigator.userAgent) ? "Edge" : /Chrome/.test(navigator.userAgent) ? "Chrome" : "Safari"}`;
  const makeReporter = (
    connection: PreparedConnection | undefined,
    environmentId: EnvironmentId,
  ) => ({
    connection,
    publisher: makePublisher(environmentId),
    changes: createComposerDraftChanges(),
    stashes: undefined as ReturnType<typeof usePromptStashStore.getState>["entries"] | undefined,
  });
  const reporters = new Map<EnvironmentId, ReturnType<typeof makeReporter>>();
  const update = () => {
    const targets = appAtomRegistry.get(reportTargetsAtom);
    for (const [environmentId, connection] of targets) {
      if (!reporters.has(environmentId))
        reporters.set(environmentId, makeReporter(connection, environmentId));
    }
    const state = useComposerDraftStore.getState();
    const stashes = usePromptStashStore.getState().entries;
    const uploads = useAttachmentUploadStore.getState().uploadsByImageId;
    for (const [environmentId, reporter] of reporters) {
      const connection = targets.get(environmentId);
      const reconnected = reporter.connection !== connection;
      reporter.connection = connection;
      if (connection === undefined) reporter.publisher.pause();
      if (reporter.stashes !== stashes) {
        reporter.stashes = stashes;
        reporter.publisher.update({
          clientId,
          clientName,
          threadId: null,
          entries: stashes.filter(
            (entry) => entry.environmentId === environmentId && !entry.pendingImageCount,
          ),
        });
      }
      for (const { threadId, draft } of reporter.changes(state, environmentId, uploads)) {
        try {
          const entry = draft === null ? null : draftEntry(threadId, environmentId, draft);
          reporter.publisher.update({
            clientId,
            clientName,
            threadId,
            entries:
              entry === null ||
              (!entry.prompt.trim() &&
                entry.attachments.length === 0 &&
                !entry.files?.length &&
                !entry.records?.length)
                ? []
                : [entry],
          });
        } catch (error) {
          useSharingStatus.setState((current) => ({
            errors: {
              ...current.errors,
              [environmentId]:
                error instanceof Error ? error.message : "Could not share this draft.",
            },
          }));
        }
      }
      if (connection !== undefined && reconnected) reporter.publisher.reconnect();
    }
  };
  const flush = () => {
    for (const reporter of reporters.values()) void reporter.publisher.flush();
  };
  const subscriptions = [
    useComposerDraftStore.subscribe(update),
    usePromptStashStore.subscribe(update),
    useAttachmentUploadStore.subscribe(update),
    appAtomRegistry.subscribe(reportTargetsAtom, update),
  ];
  window.addEventListener("pagehide", flush);
  update();
  return () => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    window.removeEventListener("pagehide", flush);
    for (const reporter of reporters.values()) reporter.publisher.dispose();
  };
}

export function useComposerSharing(environmentId: EnvironmentId, threadId: ThreadId | null) {
  const [clientId] = useState(getClientId);
  const entriesResult = useAtomValue(
    composerStorage.entries({ environmentId, input: { clientId, threadId } }),
  );
  const canCopy = useAtomValue(composerStorage.copy.permissionAtom(environmentId));
  const publishError = useSharingStatus((state) => state.errors[environmentId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds legacy persisted stashes to the environment the user opens
  useEffect(() => {
    usePromptStashStore.getState().bindUnscopedEntries(environmentId);
  }, [environmentId]);
  return {
    entries: AsyncResult.getOrElse(entriesResult, () => []),
    error:
      entriesResult._tag === "Failure"
        ? "Could not load other clients' prompts."
        : (publishError ?? null),
    canCopy,
    loading: entriesResult._tag === "Initial",
  };
}
