import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { getDefaultClientSettings } from "./clientSettingsDefaults";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client settings defaults", () => {
  it.each([
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5],
    ["iPad", "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "iPad", 5],
    ["iPad desktop mode", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5],
    ["Android phone", "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile", "Linux armv8l", 5],
    ["Android tablet", "Mozilla/5.0 (Linux; Android 15; Pixel Tablet)", "Linux armv8l", 5],
  ] as const)("uses modifier Enter on %s", (_name, userAgent, platform, maxTouchPoints) => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints });

    expect(getDefaultClientSettings()).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      sendShortcut: "mod-enter",
    });
    expect(getDefaultClientSettings()).toBe(getDefaultClientSettings());
  });

  it.each([
    ["Mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 0],
    ["Windows touch screen", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 10],
    ["unknown browser", "", "", 0],
  ] as const)("keeps Enter on %s", (_name, userAgent, platform, maxTouchPoints) => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { userAgent, platform, maxTouchPoints });

    expect(getDefaultClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
  });

  it("keeps desktop app defaults even with a mobile user agent", () => {
    vi.stubGlobal("window", { desktopBridge: {} });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    });

    expect(getDefaultClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
  });

  it("keeps shared defaults outside a browser", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);

    expect(getDefaultClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
  });
});
