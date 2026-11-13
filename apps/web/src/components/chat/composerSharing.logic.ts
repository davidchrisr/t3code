import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type { useComposerDraftStore } from "../../composerDraftStore";
import type { AttachmentUploadState } from "../../lib/attachmentUploadState";

export function composerDraftsToShare(
  state: ReturnType<typeof useComposerDraftStore.getState>,
  environmentId: EnvironmentId,
) {
  return Object.entries(state.draftsByThreadKey).flatMap(([key, draft]) => {
    if (state.draftThreadsByThreadKey[key] !== undefined) return [];
    const ref = parseScopedThreadKey(key);
    return ref?.environmentId === environmentId ? [{ threadId: ref.threadId, draft }] : [];
  });
}

export function createComposerDraftChanges() {
  const previous = new Map<
    ThreadId,
    {
      draft: ReturnType<typeof composerDraftsToShare>[number]["draft"];
      uploads: ReadonlyArray<string | undefined>;
    }
  >();
  return (
    state: ReturnType<typeof useComposerDraftStore.getState>,
    environmentId: EnvironmentId,
    uploadsById: Readonly<Record<string, AttachmentUploadState>>,
  ) => {
    const current = composerDraftsToShare(state, environmentId);
    const retained = new Set(current.map(({ threadId }) => threadId));
    const changed: Array<{ threadId: ThreadId; draft: (typeof current)[number]["draft"] | null }> =
      [];
    for (const value of current) {
      const uploads = [...value.draft.images, ...value.draft.files].map((file) => {
        const upload = uploadsById[file.id];
        return upload?.status === "ready" && upload.environmentId === environmentId
          ? upload.attachmentId
          : undefined;
      });
      const before = previous.get(value.threadId);
      if (
        before?.draft === value.draft &&
        uploads.length === before.uploads.length &&
        uploads.every((id, index) => id === before.uploads[index])
      )
        continue;
      previous.set(value.threadId, { draft: value.draft, uploads });
      changed.push(value);
    }
    for (const threadId of previous.keys()) {
      if (retained.has(threadId)) continue;
      previous.delete(threadId);
      changed.push({ threadId, draft: null });
    }
    return changed;
  };
}
