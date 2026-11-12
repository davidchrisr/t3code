import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient } from "effect/http";

import { previewBrowserRelease } from "../src/preview/PreviewBrowser.ts";
import { stagePreviewBrowser } from "./stage-preview-browser.ts";

it.layer(NodeServices.layer)("stagePreviewBrowser", (it) => {
  it.effect.each([
    { platform: "linux", arch: "arm64" },
    { platform: "linux", arch: "x64" },
    { platform: "mac", arch: "arm64" },
    { platform: "mac", arch: "x64" },
    { platform: "mac", arch: "universal" },
    { platform: "win", arch: "arm64" },
    { platform: "win", arch: "x64" },
  ] as const)("packages the browser and its resources for $platform-$arch", (target) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-stage-browser-" });
      const destinationDirectory = path.join(root, "payload", "chrome-headless-shell");
      const platform =
        target.platform === "mac" ? "darwin" : target.platform === "win" ? "win32" : "linux";
      const architectures =
        target.arch === "universal" ? (["arm64", "x64"] as const) : [target.arch];
      const executable =
        target.platform === "win" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
      for (const arch of architectures) {
        const release = previewBrowserRelease(platform, arch)!;
        const source = path.join(
          root,
          "tools",
          "chrome-headless-shell",
          release.platform,
          release.version,
        );
        yield* fs.makeDirectory(path.join(source, "locales"), { recursive: true });
        yield* fs.writeFileString(path.join(source, executable), release.platform);
        yield* fs.chmod(path.join(source, executable), 0o755);
        yield* fs.writeFileString(path.join(source, "locales", "en-US.pak"), "strings");
        yield* fs.writeFileString(path.join(source, "icudtl.dat"), "data");
      }

      yield* stagePreviewBrowser({ cacheDir: root, destinationDirectory, ...target }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected download")),
        ),
      );

      assert.deepEqual(
        (yield* fs.readDirectory(destinationDirectory)).toSorted(),
        architectures.toSorted(),
      );
      for (const arch of architectures) {
        const browser = path.join(destinationDirectory, arch);
        assert.equal(
          yield* fs.readFileString(path.join(browser, executable)),
          previewBrowserRelease(platform, arch)!.platform,
        );
        assert.equal(
          yield* fs.readFileString(path.join(browser, "locales", "en-US.pak")),
          "strings",
        );
        assert.equal(yield* fs.readFileString(path.join(browser, "icudtl.dat")), "data");
        if ((yield* HostProcess.Platform) !== "win32")
          assert.equal((yield* fs.stat(path.join(browser, executable))).mode & 0o777, 0o755);
      }
    }).pipe(Effect.scoped),
  );
});
