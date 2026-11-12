import * as HostProcess from "@t3tools/shared/HostProcess";
// @effect-diagnostics nodeBuiltinImport:off - Executes the packaged refusal against an isolated cache fixture.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { buildNpmLauncher } from "./build-npm-launcher.ts";

it.layer(NodeServices.layer)("build-npm-launcher", (it) => {
  it.effect("packages a refusal that never launches a cached executable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "fork-npm-disabled-" });
      const output = yield* buildNpmLauncher({
        version: "1.2.3",
        outputDir: path.join(root, "out"),
      });
      const home = path.join(root, "home");
      const cache = path.join(home, "runtime", "versions", "1.2.3");
      const marker = path.join(root, "executed");
      yield* fs.makeDirectory(cache, { recursive: true });
      yield* fs.writeFileString(path.join(cache, ".install-complete"), "1.2.3\n");
      const executable = path.join(
        cache,
        (yield* HostProcess.Platform) === "win32" ? "t3.exe" : "t3",
      );
      yield* fs.writeFileString(executable, '#!/bin/sh\nprintf called > "$T3FORK_TEST_MARKER"\n');
      yield* fs.chmod(executable, 0o755);
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [path.join(output.packageDir, "bin", "t3.mjs"), "serve"],
        {
          env: { ...process.env, NODE_OPTIONS: "", T3FORK_HOME: home, T3FORK_TEST_MARKER: marker },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 1);
      assert.include(result.stderr, "disabled in T3 Fork");
      assert.isFalse(yield* fs.exists(marker));
      assert.equal(yield* fs.readFileString(path.join(cache, ".install-complete")), "1.2.3\n");
    }),
  );
});
