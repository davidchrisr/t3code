import { createMemoryHistory } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The route loads ChatView lazily, and its first transform (React Compiler over ~4k lines)
// takes 6-11s; importing it here keeps that out of the test's timeout.
import "~/components/ChatView";
import {
  DraftId,
  composerTargetKey,
  useComposerDraftStore,
  type ComposerFileAttachment,
} from "~/composerDraftStore";
import { threadEnvironment } from "~/state/threads";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";
import {
  addPreparingComposerImages,
  removePreparingComposerImages,
} from "./chat/preparingComposerImages";
import { pendingDraftWork } from "./chat/pendingDraftWork";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

it.each(["success", "failure"] as const)(
  "sends a saved reply without the current draft or its files on %s",
  async (outcome) => {
    const thread = threadWithHistory(`saved-reply-${outcome}`, 1);
    const text = "Please continue.\nKeep the existing tests.";
    using _environment = installFakeEnvironment([thread], {
      savedReplies: [{ id: "continue", name: "Continue", text }],
    });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    const target = scopeThreadRef(ENVIRONMENT_ID, thread.id);
    const file: ComposerFileAttachment = {
      type: "file",
      id: "unsent-file",
      name: "draft.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      file: null,
    };
    useComposerDraftStore.getState().setPrompt(target, "Keep this unfinished draft");
    useComposerDraftStore.getState().addFiles(target, [file], { appendReference: false });
    const router = getRouter(
      createMemoryHistory({
        initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`],
      }),
    );
    await router.load();
    await using screen = await render(<AppRoot router={router} />, {
      // AppRoot brings its own router.
      router: false,
    });
    using startTurn = vi
      .spyOn(threadEnvironment.startTurn, "run")
      .mockResolvedValue(
        outcome === "success"
          ? AsyncResult.success({ sequence: 1 })
          : AsyncResult.failure(Cause.die(new Error("Saved reply rejected"))),
      );
    await expect.element(page.getByTestId("composer-editor")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Saved replies", exact: true }));
    await userEvent.click(page.getByRole("menuitem", { name: "Continue", exact: true }));

    await vi.waitFor(() => {
      expect(startTurn).toHaveBeenCalledTimes(1);
      expect(startTurn.mock.calls[0]?.[1]).toMatchObject({
        environmentId: ENVIRONMENT_ID,
        input: {
          threadId: thread.id,
          message: { text, attachments: [] },
          dispatchMode: "start",
        },
      });
      expect(startTurn.mock.calls[0]?.[1].input.message.context).toBeUndefined();
      expect(useComposerDraftStore.getState().getComposerDraft(target)).toMatchObject({
        prompt: "Keep this unfinished draft",
        files: [file],
      });
    });
    if (outcome === "failure") {
      await expect.element(page.getByText("Saved reply rejected", { exact: true })).toBeVisible();
    } else {
      await expect.element(page.getByText(text, { exact: true })).toBeVisible();
    }
    expect(useComposerDraftStore.getState().getComposerDraft(target)?.prompt).toBe(
      "Keep this unfinished draft",
    );
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("a new draft does not load its reserved thread before the server lists it", async () => {
  using _environment = installFakeEnvironment([]);
  using fetchSpy = vi.spyOn(globalThis, "fetch");
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const draftId = DraftId.make("draft-27443");
  const threadId = ThreadId.make("thread-27443");
  useComposerDraftStore
    .getState()
    .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, { threadId });

  const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByTestId("composer-editor")).toBeVisible();
  // The shell snapshot has arrived once the sidebar lists the project, so the connection is up.
  await expect.element(page.getByText("render", { exact: true }).first()).toBeVisible();

  const threadRequests = fetchSpy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => url.includes(`/api/orchestration/threads/${threadId}/`));
  // A 404 here marks the thread deleted, and the view never loads it once the send creates it.
  expect(threadRequests).toEqual([]);
});

it.each(["image", "context"] as const)(
  "waits for a pending %s before sending a saved reply from a new draft",
  async (kind) => {
    using _environment = installFakeEnvironment([], {
      savedReplies: [{ id: "continue", name: "Continue", text: "Please continue." }],
    });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    const draftId = DraftId.make(`saved-reply-preparing-${kind}`);
    useComposerDraftStore
      .getState()
      .setProjectDraftThreadId(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), draftId, {
        threadId: ThreadId.make(`saved-reply-preparing-${kind}`),
      });
    const router = getRouter(createMemoryHistory({ initialEntries: [`/draft/${draftId}`] }));
    await router.load();
    await using screen = await render(<AppRoot router={router} />, {
      // AppRoot brings its own router.
      router: false,
    });
    using startTurn = vi
      .spyOn(threadEnvironment.startTurn, "run")
      .mockResolvedValue(AsyncResult.success({ sequence: 1 }));
    await expect.element(page.getByTestId("composer-editor")).toBeVisible();
    await expect.element(page.getByText("render", { exact: true }).first()).toBeVisible();
    const targetKey = composerTargetKey(draftId);
    const imageIds = new Set(["pending-image"]);
    const finishPreparation = () => {
      if (kind === "image") removePreparingComposerImages(targetKey, imageIds);
      else pendingDraftWork.end(targetKey);
    };
    using _preparation = { [Symbol.dispose]: finishPreparation };
    await act(() => {
      if (kind === "image") {
        addPreparingComposerImages(targetKey, [
          {
            id: "pending-image",
            name: "pending.png",
            file: new File(["image"], "pending.png", { type: "image/png" }),
          },
        ]);
      } else pendingDraftWork.begin(targetKey);
    });
    await userEvent.click(screen.getByRole("button", { name: "Saved replies", exact: true }));
    await userEvent.click(page.getByRole("menuitem", { name: "Continue", exact: true }));
    await expect
      .element(
        page.getByText(
          kind === "image"
            ? "Still compressing a pasted image."
            : "Still bringing attached context into this message.",
          { exact: true },
        ),
      )
      .toBeVisible();
    expect(startTurn).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)?.promotedTo).toBeNull();

    await act(finishPreparation);
    await userEvent.click(screen.getByRole("button", { name: "Saved replies", exact: true }));
    await userEvent.click(page.getByRole("menuitem", { name: "Continue", exact: true }));
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(1));
  },
);
