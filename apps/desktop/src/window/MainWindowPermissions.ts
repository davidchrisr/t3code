import * as Electron from "electron";
import { mainWindowPermissionAllowed } from "./mainWindowPermissionPolicy.ts";

export function installMainWindowPermissions(
  contents: Electron.WebContents,
  appUrl: string,
  platform: NodeJS.Platform,
): void {
  contents.session.setPermissionCheckHandler(
    (requester, permission, origin) =>
      requester?.id === contents.id && mainWindowPermissionAllowed(permission, origin, appUrl),
  );
  contents.session.setPermissionRequestHandler((requester, permission, callback, details) => {
    if (
      requester.id !== contents.id ||
      !mainWindowPermissionAllowed(permission, details.requestingUrl, appUrl)
    ) {
      callback(false);
      return;
    }
    if (
      permission !== "media" ||
      platform !== "darwin" ||
      !("mediaTypes" in details) ||
      !details.mediaTypes?.includes("audio")
    ) {
      callback(true);
      return;
    }
    const status = Electron.systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") callback(true);
    else if (status === "not-determined")
      void Electron.systemPreferences
        .askForMediaAccess("microphone")
        .then(callback, () => callback(false));
    else callback(false);
  });
}
