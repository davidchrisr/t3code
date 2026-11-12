import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ProcessRunner from "../processRunner.ts";
import { resolveNewestVersion } from "../cli/update.ts";
import * as NpmRelease from "./npmRelease.ts";
import { ensurePinnedRuntimeInstalled, isUnpublishedRelease } from "./pinnedRuntime.ts";

it.layer(NodeServices.layer)("fork runtime distribution", (it) => {
  it.effect.each([false, true])(
    "fails missing fork releases without using legacy cache, cached=%s",
    (cached) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "fork-release-missing-" });
        const legacy = path.join(baseDir, "runtime", "versions", "1.2.3");
        if (cached) {
          yield* fs.makeDirectory(legacy, { recursive: true });
          yield* fs.writeFileString(path.join(legacy, "t3"), "cached upstream runtime");
          yield* fs.writeFileString(path.join(legacy, ".install-complete"), "1.2.3\n");
        }
        const requests: string[] = [];
        let validated = false;
        const error = yield* ensurePinnedRuntimeInstalled({
          baseDir,
          version: "1.2.3",
          fs,
          path,
          platform: "linux",
          arch: "x64",
          httpClient: HttpClient.make((request) => {
            requests.push(request.url);
            return Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response(null, { status: 404 })),
            );
          }),
          runner: ProcessRunner.ProcessRunner.of({ run: () => Effect.die("unexpected execution") }),
          validate: () =>
            Effect.sync(() => {
              validated = true;
            }),
        }).pipe(Effect.flip);
        assert.isTrue(isUnpublishedRelease(error));
        assert.deepStrictEqual(requests, [
          "https://github.com/davidchrisr/t3code/releases/download/v1.2.3/SHA256SUMS",
        ]);
        assert.isFalse(validated);
        assert.deepStrictEqual(
          yield* fs.readDirectory(path.join(baseDir, "runtime", "fork-versions")),
          [],
        );
        if (cached)
          assert.equal(
            yield* fs.readFileString(path.join(legacy, "t3")),
            "cached upstream runtime",
          );
      }),
  );

  it.effect("reports no matching fork release without querying upstream", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const error = yield* resolveNewestVersion("stable").pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            requests.push(request.url);
            return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json([])));
          }),
        ),
        Effect.flip,
      );
      assert.include(error.message, "No published stable release");
      assert.deepStrictEqual(requests, [
        "https://api.github.com/repos/davidchrisr/t3code/releases?per_page=100&page=1",
      ]);
    }),
  );

  it.effect("refuses npm lookup without network or processes", () =>
    Effect.gen(function* () {
      const registry = yield* NpmRelease.make().pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("unexpected network")),
        ),
        Effect.provideService(
          ProcessRunner.ProcessRunner,
          ProcessRunner.ProcessRunner.of({ run: () => Effect.die("unexpected npm execution") }),
        ),
      );
      const error = yield* registry.get({ spec: "latest" }).pipe(Effect.flip);
      assert.include(error.message, "disabled in T3 Fork");
    }),
  );
});
