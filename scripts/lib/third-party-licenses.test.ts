// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the Node filesystem build boundary.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { generateThirdPartyLicenseManifest } from "./third-party-licenses.js";

const tempDirectories: string[] = [];
const REPOSITORY_ROOT = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../..",
);
const DEVICE_TOOL_VERSIONS = JSON.parse(
  await NodeFSP.readFile(
    NodePath.join(REPOSITORY_ROOT, "apps/server/src/device/deviceToolVersions.json"),
    "utf8",
  ),
) as { readonly "agent-device": string; readonly "expo-device-hub": string };

async function writeJson(path: string, value: unknown): Promise<void> {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
  await NodeFSP.writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function createFixture(): Promise<{
  readonly appManifest: string;
  readonly configFile: string;
  readonly dependencyRoot: string;
  readonly root: string;
}> {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-licenses-"));
  tempDirectories.push(root);
  const appManifest = NodePath.join(root, "package.json");
  const dependencyRoot = NodePath.join(root, "node_modules", "demo-dependency");
  const configFile = NodePath.join(root, "third-party-licenses.config.json");

  await writeJson(appManifest, {
    name: "fixture-app",
    dependencies: { "demo-dependency": "1.2.3" },
  });
  await writeJson(NodePath.join(dependencyRoot, "package.json"), {
    name: "demo-dependency",
    version: "1.2.3",
    license: "MIT",
    main: "index.js",
    repository: "example/demo-dependency",
  });
  await NodeFSP.writeFile(NodePath.join(dependencyRoot, "index.js"), "export {};\n", "utf8");
  await NodeFSP.writeFile(
    NodePath.join(dependencyRoot, "LICENSE"),
    "Demo MIT license text\n",
    "utf8",
  );
  await NodeFSP.writeFile(NodePath.join(root, "asset-notice.txt"), "Asset notice text\n", "utf8");
  await writeJson(configFile, {
    customNotices: [
      {
        name: "demo-asset",
        license: "CC-BY-4.0",
        noticeFile: "asset-notice.txt",
        bundles: ["assets", "web"],
      },
    ],
    packageOverrides: [],
  });
  return { appManifest, configFile, dependencyRoot, root };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { force: true, recursive: true })),
  );
});

describe("third-party license generation", () => {
  it.each(["web", "mobile"])(
    "uses installer pins for device tool notices in the %s manifest",
    async (bundle) => {
      const fixture = await createFixture();
      await writeJson(fixture.configFile, {
        customNotices: [
          {
            name: "agent-device",
            license: "MIT",
            noticeFile: "asset-notice.txt",
            bundles: ["device-tools"],
            includeInBundles: ["web", "mobile"],
          },
          {
            name: "expo-device-hub",
            license: "MIT",
            noticeFile: "asset-notice.txt",
            version: "0.0.0",
            bundles: ["device-tools"],
            includeInBundles: ["web", "mobile"],
          },
          {
            name: "vendored-asset",
            license: "MIT",
            noticeFile: "asset-notice.txt",
            version: "1.2.3",
            bundles: ["web", "mobile"],
          },
        ],
      });

      const manifest = await generateThirdPartyLicenseManifest({
        configFile: fixture.configFile,
        packageManifests: [{ bundle, path: fixture.appManifest }],
      });

      expect(manifest.entries.find((entry) => entry.name === "agent-device")).toMatchObject({
        version: DEVICE_TOOL_VERSIONS["agent-device"],
        bundles: ["device-tools"],
      });
      expect(manifest.entries.find((entry) => entry.name === "expo-device-hub")).toMatchObject({
        version: DEVICE_TOOL_VERSIONS["expo-device-hub"],
        bundles: ["device-tools"],
      });
      expect(manifest.entries.find((entry) => entry.name === "vendored-asset")?.version).toBe(
        "1.2.3",
      );
    },
  );

  it("collects production packages and custom asset notices", async () => {
    const fixture = await createFixture();
    const workspace = NodePath.join(fixture.root, "node_modules", "@t3tools", "fixture");
    await writeJson(fixture.appManifest, {
      name: "fixture-app",
      dependencies: { "@t3tools/fixture": "workspace:*" },
    });
    await writeJson(NodePath.join(workspace, "package.json"), {
      name: "@t3tools/fixture",
      main: "index.js",
      dependencies: { "demo-dependency": "1.2.3" },
    });
    await NodeFSP.writeFile(NodePath.join(workspace, "index.js"), "export {};\n", "utf8");
    const bundledModuleIds: string[] = [];
    for (const name of ["jsx-runtime", "preact-hooks"]) {
      const nestedRoot = NodePath.join(fixture.dependencyRoot, name);
      await writeJson(NodePath.join(nestedRoot, "package.json"), { name, main: "index.js" });
      const modulePath = NodePath.join(nestedRoot, "index.js");
      await NodeFSP.writeFile(modulePath, "export {};\n", "utf8");
      bundledModuleIds.push(modulePath);
    }
    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
      bundledModuleIds,
      bundleName: "web",
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      entries: [
        {
          bundles: ["assets", "web"],
          kind: "custom",
          license: "CC-BY-4.0",
          name: "demo-asset",
          noticeText: "Asset notice text",
          sourceUrl: null,
          version: null,
        },
        {
          bundles: ["web"],
          kind: "package",
          license: "MIT",
          name: "demo-dependency",
          noticeText: "Demo MIT license text",
          sourceUrl: "https://github.com/example/demo-dependency",
          version: "1.2.3",
        },
      ],
    });
  });

  it("renders generated notices from the committed SPDX templates", async () => {
    const fixture = await createFixture();
    await writeJson(NodePath.join(fixture.root, "third-party-licenses/spdx/v3.28.0/MIT.json"), {
      licenseId: "MIT",
      licenseText: "MIT License\n\nCopyright (c) <year> <copyright holders>\n\nPermission text",
    });
    await writeJson(fixture.configFile, {
      customNotices: [
        {
          name: "generated-asset",
          license: "MIT",
          generatedNotices: [
            {
              licenseId: "MIT",
              copyrights: ["Copyright (c) 2026 Example Author"],
              preamble: ["Adapted for T3 Code."],
            },
          ],
          bundles: ["assets", "web"],
        },
      ],
      packageOverrides: [],
    });

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });

    expect(manifest.entries.find((entry) => entry.name === "generated-asset")?.noticeText).toBe(
      "Adapted for T3 Code.\n\nMIT License\n\nCopyright (c) 2026 Example Author\n\nPermission text",
    );
  });

  it.each([
    {
      label: "hidden manifest and entry point",
      name: "demo-dependency",
      specifier: "1.2.3",
      exports: {},
    },
    {
      label: "declared alias with an exported manifest",
      name: "@example/forked-dependency",
      specifier: "npm:@example/forked-dependency@1.2.3",
      exports: { ".": "./index.js", "./package.json": "./package.json" },
    },
    {
      label: "overridden alias with a hidden manifest",
      name: "@example/forked-dependency",
      specifier: "1.2.3",
      exports: { ".": "./index.js" },
    },
    {
      label: "overridden alias with a hidden manifest and entry point",
      name: "@example/forked-dependency",
      specifier: "1.2.3",
      exports: {},
    },
    {
      label: "alias with a versioned nested entry manifest",
      name: "@example/forked-dependency",
      specifier: "npm:@example/forked-dependency@1.2.3",
      exports: { ".": "./nested/index.js" },
      nestedVersion: "9.0.0",
    },
    {
      label: "versionless alias target below a versioned application",
      name: "@example/workspace-dependency",
      specifier: "workspace:@example/workspace-dependency@*",
      exports: { ".": "./index.js" },
      version: undefined,
    },
  ])("finds production package notices for $label", async (input) => {
    const { name, specifier, exports } = input;
    const version = "version" in input ? input.version : "1.2.3";
    const fixture = await createFixture();
    await writeJson(fixture.appManifest, {
      name: "fixture-app",
      version: "4.5.6",
      dependencies: { "demo-dependency": specifier },
    });
    await writeJson(NodePath.join(fixture.dependencyRoot, "package.json"), {
      name,
      version,
      license: "MIT",
      exports,
      repository: "example/demo-dependency",
    });
    if ("nestedVersion" in input) {
      const nestedRoot = NodePath.join(fixture.dependencyRoot, "nested");
      await writeJson(NodePath.join(nestedRoot, "package.json"), {
        name: "nested-entry",
        version: input.nestedVersion,
        license: "Apache-2.0",
      });
      await NodeFSP.writeFile(NodePath.join(nestedRoot, "index.js"), "export {};\n", "utf8");
    }
    if (version === undefined) {
      const workspaceRoot = NodePath.join(fixture.root, "workspace-package");
      await NodeFSP.rename(fixture.dependencyRoot, workspaceRoot);
      await NodeFSP.symlink(workspaceRoot, fixture.dependencyRoot, "junction");
    }

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
      ...("nestedVersion" in input
        ? {
            bundledModuleIds: [NodePath.join(fixture.dependencyRoot, "nested", "index.js")],
            bundleName: "web",
          }
        : {}),
    });

    expect(manifest.entries.filter((entry) => entry.kind === "package")).toEqual([
      {
        bundles: ["web"],
        kind: "package",
        license: "MIT",
        name,
        noticeText: "Demo MIT license text",
        sourceUrl: "https://github.com/example/demo-dependency",
        version: version ?? "unknown",
      },
    ]);
  });

  it("leaves type-only packages out of the notices but still walks their dependencies", async () => {
    const fixture = await createFixture();
    const modules = NodePath.join(fixture.root, "node_modules");
    const write = async (name: string, packageJson: Record<string, unknown>) => {
      await writeJson(NodePath.join(modules, name, "package.json"), {
        name,
        version: "1.0.0",
        license: "MIT",
        ...packageJson,
      });
      await NodeFSP.writeFile(NodePath.join(modules, name, "LICENSE"), `${name} license\n`, "utf8");
    };
    await writeJson(fixture.appManifest, {
      name: "fixture-app",
      dependencies: { "demo-dependency": "1.2.3", "@types/demo": "1.0.0" },
    });
    await write("@types/demo", {
      main: "",
      types: "index.d.ts",
      exports: {
        ".": { types: { import: "./index.d.mts", default: "./index.d.ts" } },
        "./package.json": "./package.json",
      },
      dependencies: { "demo-css-types": "1.0.0", "demo-runtime": "1.0.0" },
    });
    await write("demo-css-types", { main: "", types: "index.d.ts" });
    await write("demo-runtime", { main: "index.js" });

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });

    const names = manifest.entries.map((entry) => entry.name);
    expect(names).toContain("demo-dependency");
    expect(names).toContain("demo-runtime");
    expect(names).not.toContain("@types/demo");
    expect(names).not.toContain("demo-css-types");
  });

  it.each([
    {
      shape: "a JS entry next to its declarations",
      entry: {
        main: "./dist/index.mjs",
        exports: { ".": { types: "./dist/index.d.mts", import: "./dist/index.mjs" } },
      },
      indexFile: null,
    },
    { shape: "only a stylesheet", entry: { main: "", style: "dist/theme.css" }, indexFile: null },
    {
      shape: "only a react-native entry",
      entry: { main: "", "react-native": "lib/index.native.js" },
      indexFile: null,
    },
    { shape: "an index.js behind an empty main", entry: { main: "" }, indexFile: "index.js" },
    { shape: "an index.node addon and no main", entry: {}, indexFile: "index.node" },
  ])("keeps a package that declares types but ships $shape", async ({ entry, indexFile }) => {
    const fixture = await createFixture();
    await writeJson(NodePath.join(fixture.dependencyRoot, "package.json"), {
      name: "demo-dependency",
      version: "1.2.3",
      license: "MIT",
      types: "./dist/index.d.mts",
      ...entry,
      repository: "example/demo-dependency",
    });
    if (indexFile !== "index.js") {
      await NodeFSP.rm(NodePath.join(fixture.dependencyRoot, "index.js"));
    }
    if (indexFile !== null) {
      await NodeFSP.writeFile(NodePath.join(fixture.dependencyRoot, indexFile), "", "utf8");
    }

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });

    expect(manifest.entries.some((entry) => entry.name === "demo-dependency")).toBe(true);
  });

  it("fails when a production package has no distributable notice text", async () => {
    const fixture = await createFixture();
    await NodeFSP.rm(NodePath.join(fixture.dependencyRoot, "LICENSE"));

    await expect(
      generateThirdPartyLicenseManifest({
        configFile: fixture.configFile,
        packageManifests: [{ bundle: "web", path: fixture.appManifest }],
      }),
    ).rejects.toThrow("does not include a license or notice file");
  });

  it("collects nested notices even when a package also has a root license", async () => {
    const fixture = await createFixture();
    await NodeFSP.mkdir(NodePath.join(fixture.dependencyRoot, "dist", "third-party"), {
      recursive: true,
    });
    await NodeFSP.mkdir(NodePath.join(fixture.dependencyRoot, "lib"), { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(fixture.dependencyRoot, "dist", "third-party", "NOTICE.txt"),
      "Nested notice\n",
      "utf8",
    );
    await NodeFSP.writeFile(
      NodePath.join(fixture.dependencyRoot, "lib", "license_header.js"),
      "require('not-a-license');\n",
      "utf8",
    );

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });

    expect(manifest.entries.find((entry) => entry.name === "demo-dependency")?.noticeText).toBe(
      "dist/third-party/NOTICE.txt\n\nNested notice\n\n---\n\nLICENSE\n\nDemo MIT license text",
    );
  });

  it("uses package overrides for notices published outside the npm archive", async () => {
    const fixture = await createFixture();
    await NodeFSP.rm(NodePath.join(fixture.dependencyRoot, "LICENSE"));
    await NodeFSP.writeFile(NodePath.join(fixture.root, "override.txt"), "Override text\n", "utf8");
    await writeJson(fixture.configFile, {
      customNotices: [],
      packageOverrides: [
        {
          name: "demo-dependency",
          noticeFile: "override.txt",
        },
      ],
    });

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });

    expect(manifest.entries[0]?.noticeText).toBe("Override text");
  });

  it("keeps all licenses and attributions in a package with multiple generated notices", async () => {
    const fixture = await createFixture();
    await NodeFSP.rm(NodePath.join(fixture.dependencyRoot, "LICENSE"));
    for (const licenseId of ["Apache-2.0", "BSD-3-Clause"]) {
      await writeJson(
        NodePath.join(fixture.root, `third-party-licenses/spdx/v3.28.0/${licenseId}.json`),
        { licenseId, licenseText: `${licenseId} terms` },
      );
    }
    await writeJson(fixture.configFile, {
      packageOverrides: [
        {
          name: "demo-dependency",
          license: "(Apache-2.0 AND BSD-3-Clause)",
          generatedNotices: [
            { licenseId: "Apache-2.0", copyrights: ["Copyright primary author"] },
            { licenseId: "BSD-3-Clause", copyrights: ["Copyright vendored author"] },
          ],
        },
      ],
    });
    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });
    expect(manifest.entries[0]?.license).toBe("(Apache-2.0 AND BSD-3-Clause)");
    expect(manifest.entries[0]?.noticeText).toBe(
      "Copyright primary author\n\nApache-2.0 terms\n\n---\n\nCopyright vendored author\n\nBSD-3-Clause terms",
    );
  });

  it("reuses a repository license for packages from the same monorepo", async () => {
    const fixture = await createFixture();
    const siblingRoot = NodePath.join(fixture.root, "node_modules", "demo-sibling");
    await writeJson(fixture.appManifest, {
      name: "fixture-app",
      dependencies: { "demo-dependency": "1.2.3", "demo-sibling": "2.0.0" },
    });
    await writeJson(NodePath.join(siblingRoot, "package.json"), {
      name: "demo-sibling",
      version: "2.0.0",
      license: "MIT",
      main: "index.js",
      repository: "https://github.com/example/demo-dependency.git#main",
    });
    await NodeFSP.writeFile(NodePath.join(siblingRoot, "index.js"), "export {};\n", "utf8");

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });

    expect(manifest.entries.find((entry) => entry.name === "demo-sibling")?.noticeText).toBe(
      "Demo MIT license text",
    );
  });

  it("prefers version-specific repository overrides", async () => {
    const fixture = await createFixture();
    await NodeFSP.writeFile(NodePath.join(fixture.root, "generic.txt"), "Generic text\n", "utf8");
    await NodeFSP.writeFile(NodePath.join(fixture.root, "exact.txt"), "Exact text\n", "utf8");
    await writeJson(fixture.configFile, {
      customNotices: [],
      packageOverrides: [
        {
          repositoryUrl: "https://github.com/example/demo-dependency",
          noticeFile: "generic.txt",
        },
        {
          repositoryUrl: "https://github.com/example/demo-dependency",
          version: "1.2.3",
          noticeFile: "exact.txt",
        },
      ],
    });

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "web", path: fixture.appManifest }],
    });

    expect(manifest.entries[0]?.noticeText).toBe("Exact text");
  });

  it("omits custom notices for other bundles", async () => {
    const fixture = await createFixture();
    await writeJson(fixture.configFile, {
      customNotices: [
        {
          name: "web-only-asset",
          license: "MIT",
          noticeFile: "asset-notice.txt",
          bundles: ["assets", "web"],
        },
      ],
      packageOverrides: [],
    });

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "mobile", path: fixture.appManifest }],
    });

    expect(manifest.entries.some((entry) => entry.name === "web-only-asset")).toBe(false);
  });

  it("can show a multi-file notice under a label that differs from its client manifests", async () => {
    const fixture = await createFixture();
    await NodeFSP.writeFile(
      NodePath.join(fixture.root, "tool-license.txt"),
      "Tool license\n",
      "utf8",
    );
    await NodeFSP.writeFile(
      NodePath.join(fixture.root, "vendor-notice.txt"),
      "Vendor notice\n",
      "utf8",
    );
    await writeJson(fixture.configFile, {
      customNotices: [
        {
          name: "optional-tool",
          license: "MIT AND Apache-2.0",
          noticeFiles: ["tool-license.txt", "vendor-notice.txt"],
          bundles: ["device-tools"],
          includeInBundles: ["mobile", "web"],
        },
      ],
      packageOverrides: [],
    });

    const manifest = await generateThirdPartyLicenseManifest({
      configFile: fixture.configFile,
      packageManifests: [{ bundle: "mobile", path: fixture.appManifest }],
    });

    expect(manifest.entries.find((entry) => entry.name === "optional-tool")).toMatchObject({
      bundles: ["device-tools"],
      noticeText: "Tool license\n\n---\n\nVendor notice",
    });
  });
});
