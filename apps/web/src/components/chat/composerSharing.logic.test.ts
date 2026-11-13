import { expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useComposerDraftStore } from "../../composerDraftStore";
import { composerDraftsToShare, createComposerDraftChanges } from "./composerSharing.logic";

it("includes a background draft after its upload completes while another thread is open", () => {
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  const environmentId = EnvironmentId.make("sharing-env");
  const a = { environmentId, threadId: ThreadId.make("thread-a") };
  const b = { environmentId, threadId: ThreadId.make("thread-b") };
  const other = {
    environmentId: EnvironmentId.make("other-env"),
    threadId: ThreadId.make("other"),
  };
  const store = useComposerDraftStore.getState();
  store.setPrompt(a, "Draft on A");
  store.addFiles(a, [
    {
      type: "file",
      id: "pending-file",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      file: new File(["test"], "notes.txt", { type: "text/plain" }),
    },
  ]);
  store.setPrompt(b, "Draft on B");
  store.setPrompt(other, "Other environment");
  store.addImages(a, [
    {
      type: "image",
      id: "photo",
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 4,
      previewUrl: "blob:photo",
      file: new File(["test"], "photo.png", { type: "image/png" }),
    },
  ]);
  const changes = createComposerDraftChanges();
  expect(changes(useComposerDraftStore.getState(), environmentId, {})).toHaveLength(2);
  store.setFileUpload(a, "pending-file", environmentId, "uploaded-file");
  const state = useComposerDraftStore.getState();
  const drafts = composerDraftsToShare(state, environmentId);
  expect(drafts.map(({ threadId }) => threadId).sort()).toEqual([a.threadId, b.threadId].sort());
  expect(
    drafts.find(({ threadId }) => threadId === a.threadId)?.draft?.files[0]?.uploadedAttachmentId,
  ).toBe("uploaded-file");
  expect(state.draftsByThreadKey[scopedThreadKey(a)]?.prompt).toContain("Draft on A");
  expect(changes(state, environmentId, {}).map(({ threadId }) => threadId)).toEqual([a.threadId]);
  expect(changes(state, environmentId, {})).toEqual([]);
  const uploads = {
    photo: { status: "ready" as const, environmentId, attachmentId: "uploaded-photo" },
  };
  expect(changes(state, environmentId, uploads).map(({ threadId }) => threadId)).toEqual([
    a.threadId,
  ]);
  expect(changes(state, environmentId, { photo: { ...uploads.photo } })).toEqual([]);
  store.clearComposerPromptAndImages(a);
  expect(changes(useComposerDraftStore.getState(), environmentId, {})).toEqual([
    { threadId: a.threadId, draft: null },
  ]);
});
