import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): Window & typeof globalThis {
  const localStorage = createLocalStorageStub();
  const testWindow = {
    localStorage,
  } as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clientPersistenceStorage", () => {
  it("uses the mobile default when saved settings have no send preference", async () => {
    const testWindow = getTestWindow();
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    });
    testWindow.localStorage.setItem("t3code:client-settings:v1", '{"timestampFormat":"12-hour"}');
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(readBrowserClientSettings()).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      timestampFormat: "12-hour",
      sendShortcut: "mod-enter",
    });
  });

  it.each(["enter", "mod-enter-multiline", "mod-enter"] as const)(
    "preserves a mobile browser's saved %s preference",
    async (sendShortcut) => {
      const testWindow = getTestWindow();
      vi.stubGlobal("navigator", {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      });
      testWindow.localStorage.setItem(
        "t3code:client-settings:v1",
        JSON.stringify({ sendShortcut }),
      );
      const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

      expect(readBrowserClientSettings()?.sendShortcut).toBe(sendShortcut);
    },
  );

  it.each(["not-json", '{"wordWrap":"invalid"}'])(
    "does not treat invalid saved settings as absent: %s",
    async (value) => {
      const testWindow = getTestWindow();
      testWindow.localStorage.setItem("t3code:client-settings:v1", value);
      const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

      expect(() => readBrowserClientSettings()).toThrow(
        expect.objectContaining({
          _tag: "LocalStorageOperationError",
          operation: "decode",
          storageKey: "t3code:client-settings:v1",
        }),
      );
      expect(testWindow.localStorage.getItem("t3code:client-settings:v1")).toBe(value);
    },
  );

  it("preserves saved settings across a transient read failure", async () => {
    const testWindow = getTestWindow();
    const settings = { ...DEFAULT_CLIENT_SETTINGS, timestampFormat: "12-hour" as const };
    testWindow.localStorage.setItem("t3code:client-settings:v1", JSON.stringify(settings));
    const write = vi.spyOn(testWindow.localStorage, "setItem");
    const failure = new Error("storage unavailable");
    vi.spyOn(testWindow.localStorage, "getItem").mockImplementationOnce(() => {
      throw failure;
    });
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(() => readBrowserClientSettings()).toThrow(
      expect.objectContaining({
        _tag: "LocalStorageOperationError",
        operation: "read",
        storageKey: "t3code:client-settings:v1",
        cause: failure,
      }),
    );
    expect(readBrowserClientSettings()).toEqual(settings);
    expect(write).not.toHaveBeenCalled();
  });
});
