import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

class PreviewBrowserStageError extends Schema.TaggedError<PreviewBrowserStageError>()(
  "PreviewBrowserStageError",
  { exitCode: Schema.Int },
) {
  override get message(): string {
    return `Packaging Chrome Headless Shell failed with exit code ${this.exitCode}.`;
  }
}

export const stagePreviewBrowser = Effect.fn("stagePreviewBrowser")(function* (input: {
  readonly repoRoot: string;
  readonly cacheDir: string;
  readonly destinationDirectory: string;
  readonly platform: "mac" | "linux" | "win";
  readonly arch: "arm64" | "x64" | "universal";
}) {
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(
      yield* HostProcess.ExecutablePath,
      [
        path.join(input.repoRoot, "apps/server/scripts/stage-preview-browser.ts"),
        "--cache-dir",
        input.cacheDir,
        "--destination-directory",
        input.destinationDirectory,
        "--platform",
        input.platform,
        "--arch",
        input.arch,
      ],
      { cwd: input.repoRoot, stdout: "inherit", stderr: "inherit" },
    ),
  );
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) return yield* new PreviewBrowserStageError({ exitCode });
});
