import { expect, it, vi } from "vite-plus/test";

vi.mock("expo-observe", () => ({
  Observe: { configure: vi.fn(), dispatchEvents: vi.fn(), reportError: vi.fn() },
}));

it("disables crash dispatch before application startup", async () => {
  const { Observe } = await import("expo-observe");
  await import("./observe");

  expect(Observe.configure).toHaveBeenCalledExactlyOnceWith({ dispatchingEnabled: false });
  expect(Observe.dispatchEvents).not.toHaveBeenCalled();
});
