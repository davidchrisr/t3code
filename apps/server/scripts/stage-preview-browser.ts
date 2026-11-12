import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import * as PreviewBrowser from "../src/preview/PreviewBrowser.ts";

export const stagePreviewBrowser = Effect.fn("stagePreviewBrowser")(function* (input: {
  readonly cacheDir: string;
  readonly destinationDirectory: string;
  readonly platform: "mac" | "linux" | "win";
  readonly arch: "arm64" | "x64" | "universal";
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform =
    input.platform === "mac" ? "darwin" : input.platform === "win" ? "win32" : "linux";
  const architectures = input.arch === "universal" ? (["arm64", "x64"] as const) : [input.arch];
  for (const arch of architectures) {
    const browser = yield* PreviewBrowser.makePreviewBrowser({
      baseDir: input.cacheDir,
      wait: "16 minutes",
    }).pipe(
      Effect.provideService(HostProcess.Platform, platform),
      Effect.provideService(HostProcess.Architecture, arch),
    );
    const executable = yield* browser.executable;
    const destination = path.join(input.destinationDirectory, arch);
    yield* fs.copy(path.dirname(executable), destination);
    yield* Effect.log(`Bundled Chrome Headless Shell for ${platform}-${arch}.`);
  }
});

if (import.meta.main) {
  Command.run(
    Command.make(
      "stage-preview-browser",
      {
        cacheDir: Flag.String("cache-dir"),
        destinationDirectory: Flag.String("destination-directory"),
        platform: Flag.Literals("platform", ["mac", "linux", "win"]),
        arch: Flag.Literals("arch", ["arm64", "x64", "universal"]),
      },
      (input) => stagePreviewBrowser(input).pipe(Effect.scoped),
    ),
    { version: "0.0.0" },
  ).pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
    NodeRuntime.runMain,
  );
}
