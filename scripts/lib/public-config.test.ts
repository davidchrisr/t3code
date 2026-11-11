// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { build } from "vite-plus";

import { applyRepoEnv, clientTracingDisabledPlugin, loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("keeps reporting credentials from mode env files out of browser bundles", async () => {
    const root = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(root, ".env.production"),
      "VITE_RELAY_OTLP_TRACES_TOKEN=disabled-mode-ingest-token\nVITE_VISIBLE_SETTING=retained-setting\n",
    );
    const entry = NodePath.join(root, "entry.js");
    NodeFS.writeFileSync(entry, "export default import.meta.env;\n");
    const built = await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [clientTracingDisabledPlugin],
      build: { write: false, minify: false, lib: { entry, formats: ["es"] } },
    });
    const outputs = Array.isArray(built) ? built : [built];
    const chunks = outputs.flatMap((output) => {
      if (!("output" in output)) throw new Error("Expected completed browser bundle");
      return output.output.filter((file) => file.type === "chunk");
    });
    expect(chunks.length).toBeGreaterThan(0);
    const code = chunks.map((chunk) => chunk.code).join("\n");
    expect(code).not.toContain("disabled-mode-ingest-token");
    expect(code).toContain("retained-setting");
  });
  it("scrubs disabled reporting variables from the build process environment", () => {
    const env = {
      VITE_RELAY_OTLP_TRACES_TOKEN: "disabled-token",
      EXPO_PUBLIC_OTLP_TRACES_TOKEN: "disabled-mobile-token",
      T3CODE_OTLP_TRACES_URL: "https://diagnostics.example.test/v1/traces",
    };
    applyRepoEnv({ env, repoRoot: makeTemporaryDirectory() });
    expect(env).toEqual({
      T3CODE_OTLP_TRACES_URL: "https://diagnostics.example.test/v1/traces",
    });
  });
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_root\nT3CODE_CLERK_JWT_TEMPLATE=template_root\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root\nT3CODE_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_local\nT3CODE_CLERK_JWT_TEMPLATE=template_local\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_local\nT3CODE_RELAY_URL=https://local.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).T3CODE_RELAY_URL).toBe(
      "https://local.example.test",
    );
    const env = loadRepoEnv({
      baseEnv: {
        T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
        T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
        T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
        T3CODE_RELAY_URL: "https://ci.example.test",
        T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "disabled-relay-token",
        VITE_RELAY_OTLP_TRACES_TOKEN: "disabled-vite-token",
        EXPO_PUBLIC_OTLP_TRACES_TOKEN: "disabled-mobile-token",
        T3CODE_OTLP_TRACES_URL: "https://diagnostics.example.test/v1/traces",
      },
      repoRoot,
    });
    expect(env).toMatchObject({
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      T3CODE_RELAY_URL: "https://ci.example.test",
      VITE_T3CODE_RELAY_URL: "https://ci.example.test",
      T3CODE_OTLP_TRACES_URL: "https://diagnostics.example.test/v1/traces",
    });
    expect(env).not.toHaveProperty("T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN");
    expect(env).not.toHaveProperty("VITE_RELAY_OTLP_TRACES_TOKEN");
    expect(env).not.toHaveProperty("EXPO_PUBLIC_OTLP_TRACES_TOKEN");
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
