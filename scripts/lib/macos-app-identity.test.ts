// @effect-diagnostics nodeBuiltinImport:off - Fixtures exercise the Mach-O packaging boundary.
import * as NodeBuffer from "node:buffer";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { assert, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { prepareMacAppIdentity, rewriteExecutableUuids } from "./macos-app-identity.ts";

function executable(cpuType = 0x0100000c, little = true, fileType = 2) {
  const bytes = NodeBuffer.Buffer.alloc(64, 0);
  const write = (value: number, offset: number) =>
    little ? bytes.writeUInt32LE(value, offset) : bytes.writeUInt32BE(value, offset);
  write(0xfeedfacf, 0);
  write(cpuType, 4);
  write(fileType, 12);
  write(1, 16);
  write(24, 20);
  write(0x1b, 32);
  write(24, 36);
  NodeBuffer.Buffer.from("4c4c44aa55553144a1ed37cd3f6b77d3", "hex").copy(bytes, 40);
  return bytes;
}

it.each([true, false])("isolates a thin executable UUID with little endian %s", (little) => {
  const original = executable(0x0100000c, little);
  const saved = NodeBuffer.Buffer.from(original);
  const first = rewriteExecutableUuids(original, "com.t3tools.t3fork", "Contents/MacOS/T3 Fork");
  const repeat = rewriteExecutableUuids(original, "com.t3tools.t3fork", "Contents/MacOS/T3 Fork");
  const otherApp = rewriteExecutableUuids(original, "com.t3tools.t3code", "Contents/MacOS/T3 Fork");
  const helper = rewriteExecutableUuids(original, "com.t3tools.t3fork", "Contents/MacOS/Helper");
  assert.notDeepEqual(first.binary.subarray(40, 56), original.subarray(40, 56));
  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.binary, otherApp.binary);
  assert.notDeepEqual(first.binary, helper.binary);
  assert.deepEqual(first.binary.subarray(0, 40), original.subarray(0, 40));
  assert.deepEqual(first.binary.subarray(56), original.subarray(56));
  assert.deepEqual(original, saved);
});

it.each([false, true])("isolates every universal slice with a 64-bit table %s", (fat64) => {
  const entrySize = fat64 ? 32 : 20;
  const bytes = NodeBuffer.Buffer.alloc(256);
  bytes.writeUInt32BE(fat64 ? 0xcafebabf : 0xcafebabe, 0);
  bytes.writeUInt32BE(2, 4);
  for (const [index, cpuType] of [0x01000007, 0x0100000c].entries()) {
    const entry = 8 + index * entrySize;
    const start = 128 + index * 64;
    bytes.writeUInt32BE(cpuType, entry);
    if (fat64) {
      bytes.writeBigUInt64BE(BigInt(start), entry + 8);
      bytes.writeBigUInt64BE(64n, entry + 16);
    } else {
      bytes.writeUInt32BE(start, entry + 8);
      bytes.writeUInt32BE(64, entry + 12);
    }
    executable(cpuType).copy(bytes, start);
  }
  const result = rewriteExecutableUuids(bytes, "com.t3tools.t3fork", "Contents/MacOS/T3 Fork");
  assert.lengthOf(result.uuids, 2);
  assert.notEqual(result.uuids[0]?.replacement, result.uuids[1]?.replacement);
  assert.notDeepEqual(result.binary.subarray(168, 184), bytes.subarray(168, 184));
  assert.notDeepEqual(result.binary.subarray(232, 248), bytes.subarray(232, 248));
});

it("leaves shared libraries and non-Mach-O files untouched", () => {
  for (const bytes of [
    executable(0x0100000c, true, 6),
    NodeBuffer.Buffer.from("#!/bin/sh\nexit 0\n"),
  ]) {
    const result = rewriteExecutableUuids(bytes, "com.t3tools.t3fork", "shared");
    assert.strictEqual(result.binary, bytes);
    assert.isEmpty(result.uuids);
  }
});

it("rejects missing UUIDs and malformed command tables without modifying the input", () => {
  for (const damage of ["missing", "duplicate", "truncated", "command-size"] as const) {
    const bytes = executable();
    if (damage === "missing") bytes.writeUInt32LE(0x19, 32);
    if (damage === "duplicate") {
      bytes.writeUInt32LE(2, 16);
      bytes.writeUInt32LE(32, 20);
      bytes.writeUInt32LE(0x1b, 56);
      bytes.writeUInt32LE(8, 60);
    }
    if (damage === "truncated") bytes.writeUInt32LE(64, 20);
    if (damage === "command-size") bytes.writeUInt32LE(0, 36);
    const saved = NodeBuffer.Buffer.from(bytes);
    assert.throws(() => rewriteExecutableUuids(bytes, "fork", "main"), /Invalid Mach-O/);
    assert.deepEqual(bytes, saved);
  }
});

it.effect.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "prepares nested executables before signing and preserves framework UUIDs",
  () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-mac-identity-" });
      const app = NodePath.join(root, "T3 Fork.app");
      const plist =
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.t3tools.t3fork</string><key>CFBundleExecutable</key><string>T3 Fork</string></dict></plist>';
      const files = [
        ["Contents/MacOS/T3 Fork", executable()],
        ["Contents/Frameworks/Helper.app/Contents/MacOS/Helper", executable()],
        [
          "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
          executable(0x0100000c, true, 6),
        ],
      ] as const;
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.join(app, "Contents/Resources"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(app, "Contents/Info.plist"), plist);
        for (const [relative, bytes] of files) {
          const file = NodePath.join(app, relative);
          await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
          await NodeFSP.writeFile(file, bytes, { mode: 0o755 });
        }
        const executables = await prepareMacAppIdentity(app, "com.t3tools.t3fork");
        assert.lengthOf(executables, 2);
        for (const [relative, bytes] of files) {
          const actual = await NodeFSP.readFile(NodePath.join(app, relative));
          if (relative.endsWith("Electron Framework")) assert.deepEqual(actual, bytes);
          else assert.notDeepEqual(actual, bytes);
        }
        const map = await NodeFSP.readFile(
          NodePath.join(app, "Contents/Resources/t3code-executable-uuids.json"),
          "utf8",
        );
        assert.include(map, "4c4c44aa-5555-3144-a1ed-37cd3f6b77d3");
        await expect(prepareMacAppIdentity(app, "com.t3tools.t3fork")).rejects.toThrow(
          /already prepared/,
        );
      });
    }).pipe(Effect.provide(NodeServices.layer)),
);
