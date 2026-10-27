import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts/settings";

import { browserDeviceType } from "./connection/clientMetadata";

const MOBILE_WEB_CLIENT_SETTINGS: ClientSettings = {
  ...DEFAULT_CLIENT_SETTINGS,
  sendShortcut: "mod-enter",
};

export function getDefaultClientSettings(): ClientSettings {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    window.desktopBridge !== undefined
  ) {
    return DEFAULT_CLIENT_SETTINGS;
  }
  const deviceType = browserDeviceType(navigator);
  return deviceType === "mobile" || deviceType === "tablet"
    ? MOBILE_WEB_CLIENT_SETTINGS
    : DEFAULT_CLIENT_SETTINGS;
}
