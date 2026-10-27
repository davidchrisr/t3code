import { ClientSettingsSchema, type ClientSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { getDefaultClientSettings } from "./clientSettingsDefaults";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
const BrowserClientSettingsSchema = Schema.Struct({
  ...ClientSettingsSchema.fields,
  sendShortcut: ClientSettingsSchema.fields.sendShortcut.pipe(
    Schema.withDecodingDefault(Effect.sync(() => getDefaultClientSettings().sendShortcut)),
  ),
});

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, BrowserClientSettingsSchema);
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}
