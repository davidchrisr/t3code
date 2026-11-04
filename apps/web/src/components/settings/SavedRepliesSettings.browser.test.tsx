import { DEFAULT_UNIFIED_SETTINGS, type SavedReply } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { SavedRepliesSettings } from "./SavedRepliesSettings";

const state = vi.hoisted(() => ({
  replies: [] as readonly SavedReply[],
  update: vi.fn(),
}));

vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({ scope: { kind: "all" } }),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: (selector: (settings: typeof DEFAULT_UNIFIED_SETTINGS) => unknown) =>
    selector({ ...DEFAULT_UNIFIED_SETTINGS, savedReplies: state.replies }),
  useScopedSettingsMixed: () => false,
  useScopedSettingsWriteAllowed: () => true,
  useUpdateScopedSettings: () => state.update,
}));
vi.mock("./settingsLayout", () => ({
  SettingsRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function setup(replies: readonly SavedReply[] = []) {
  state.replies = replies;
  state.update.mockReset();
  let resolve!: (saved: boolean) => void;
  const promise = new Promise<boolean>((complete) => {
    resolve = complete;
  });
  const save = { promise, resolve };
  state.update.mockReturnValue(save.promise);
  return save;
}

it("retains the reply editor after a failed save and allows retry", async () => {
  const save = setup();
  await using _screen = await render(<SavedRepliesSettings />);
  await page.getByRole("button", { name: "Add reply" }).click();
  await page.getByRole("textbox", { name: "Reply name" }).fill("Proceed");
  await page.getByRole("textbox", { name: "Reply text" }).fill("Please proceed.\nKeep the draft.");
  await page.getByRole("button", { name: "Save reply" }).click();
  await expect.element(page.getByRole("button", { name: "Save reply" })).toBeDisabled();
  await act(() => save.resolve(false));
  await expect.element(page.getByRole("textbox", { name: "Reply name" })).toHaveValue("Proceed");
  await expect
    .element(page.getByRole("textbox", { name: "Reply text" }))
    .toHaveValue("Please proceed.\nKeep the draft.");
  state.update.mockResolvedValue(true);
  await page.getByRole("button", { name: "Save reply" }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(state.update).toHaveBeenCalledTimes(2);
});

it("serializes deletions without restoring a reply before its server broadcast arrives", async () => {
  const save = setup([
    { id: "a", name: "Alpha", text: "First" },
    { id: "b", name: "Beta", text: "Second" },
  ]);
  await using _screen = await render(<SavedRepliesSettings />);
  await page.getByRole("button", { name: "Delete Alpha" }).click();
  await expect.element(page.getByRole("button", { name: "Delete Beta" })).toBeDisabled();
  await act(() => save.resolve(true));
  await expect.element(page.getByRole("button", { name: "Delete Beta" })).toBeEnabled();
  state.update.mockResolvedValue(false);
  await page.getByRole("button", { name: "Delete Beta" }).click();
  await expect.element(page.getByRole("button", { name: "Delete Beta" })).toBeEnabled();
  await expect.element(page.getByRole("button", { name: "Delete Alpha" })).not.toBeInTheDocument();
  state.update.mockResolvedValue(true);
  await page.getByRole("button", { name: "Delete Beta" }).click();
  expect(state.update.mock.calls.map(([patch]) => patch.savedReplies)).toEqual([
    [{ id: "b", name: "Beta", text: "Second" }],
    [],
    [],
  ]);
});
