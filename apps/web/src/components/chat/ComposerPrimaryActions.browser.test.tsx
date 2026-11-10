import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { fakeTimers, render } from "../../../test/render";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";

vi.mock("~/hooks/useSettings", () => ({
  useEnvironmentIdentificationMode: () => "none",
}));

vi.mock("../SidebarStageBackdrop", () => ({
  StageBackdropButtonArt: () => null,
  useSidebarStageBackdropVariant: () => null,
}));

it("submits once without moving editor focus when compatibility mouse events follow a tap", async () => {
  const onSubmit = vi.fn();
  await using screen = await render(
    <form
      // Exercise mouse focus independently: iOS can blur despite a cancelled pointerdown.
      onPointerDownCapture={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea aria-label="Message" defaultValue="Send this draft" />
      <ComposerPrimaryActions
        compact
        canOperateThread
        pendingAction={null}
        isRunning={false}
        canInterrupt={false}
        isSendBusy={false}
        sendDisabledReason={null}
        isEnvironmentUnavailable={false}
        isPreparingWorktree={false}
        hasSendableContent
        preserveComposerFocusOnPointerDown
        onPreviousPendingQuestion={() => {}}
        onInterrupt={() => {}}
      />
    </form>,
  );
  using _timers = fakeTimers();
  const editor = screen.getByRole("textbox", { name: "Message" });
  await userEvent.click(editor);

  await userEvent.click(screen.getByRole("button", { name: "Submit message" }));

  await expect.element(editor).toHaveFocus();
  expect(onSubmit).toHaveBeenCalledTimes(1);
});
