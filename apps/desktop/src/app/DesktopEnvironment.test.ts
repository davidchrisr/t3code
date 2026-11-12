import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) => DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layerEnvironment(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect(
    "names the packaged macOS app independently of upstream server state and client branding",
    () =>
      Effect.gen(function* () {
        const isolatedPort = yield* makeEnvironment(
          { isPackaged: true },
          { T3CODE_PORT: "3774", T3FORK_PORT: "4773" },
        );
        assert.equal(Option.getOrUndefined(isolatedPort.configuredBackendPort), 4773);
        const environment = yield* makeEnvironment({ isPackaged: true }, { T3CODE_PORT: "3774" });
        assert.isTrue(Option.isNone(environment.configuredBackendPort));
        assert.equal(environment.displayName, "T3 Fork");
        assert.equal(environment.branding.baseName, "T3 Code");
        assert.equal(environment.baseDir, "/Users/alice/.t3fork");
        assert.equal(environment.stateDir, "/Users/alice/.t3fork/userdata");
        for (const [env, expectedHome] of [
          [{ T3CODE_HOME: "/recovery" }, "/Users/alice/.t3fork"],
          [{ T3CODE_HOME: "/recovery", T3FORK_HOME: " /fork " }, "/fork"],
          [{ T3CODE_HOME: "/recovery", T3FORK_HOME: "  " }, "/Users/alice/.t3fork"],
        ] as const) {
          const isolated = yield* makeEnvironment({ isPackaged: true }, env);
          assert.equal(isolated.baseDir, expectedHome);
          assert.equal(isolated.stateDir, `${expectedHome}/userdata`);
        }
      }),
  );

  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.t3fork/dev");
      assert.equal(production.stateDir, "/Users/alice/.t3fork/userdata");
    }),
  );
});
