import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { MACOS_FORK_IDENTITY } from "@t3tools/shared/desktopForkIdentity";
import { prepareMacAppIdentity, verifyMacAppIdentity } from "./lib/macos-app-identity.ts";

export default async function sign(
  options: SignOptions,
  packager: { readonly platformSpecificBuildOptions: { readonly identity?: string | null } },
): Promise<void> {
  await prepareMacAppIdentity(options.app, MACOS_FORK_IDENTITY.appId);
  // electron-builder can resolve "-" to a hyphenated certificate before invoking this hook.
  const identity = packager.platformSpecificBuildOptions.identity === "-" ? "-" : options.identity;
  await signApplication({
    ...options,
    ...(identity === "-" ? { identity, preAutoEntitlements: false } : {}),
    batchCodesignCalls: true,
  });
  await verifyMacAppIdentity(options.app);
}
