// @effect-diagnostics nodeBuiltinImport:off - The electron-builder signing hook runs outside an Effect runtime.
import * as NodeBuffer from "node:buffer";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import Plist from "plist";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const UUID_MAP = "t3code-executable-uuids.json";
const thinMagics = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe]);
const fatMagics = new Set([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);

const formatUuid = (bytes: NodeBuffer.Buffer) =>
  bytes.toString("hex").replace(/^(........)(....)(....)(....)(............)$/, "$1-$2-$3-$4-$5");

/** LC_UUID is covered by the code signature; only call this before signing. */
export function rewriteExecutableUuids(
  bytes: NodeBuffer.Buffer,
  bundleId: string,
  relativePath: string,
) {
  const patches: Array<{ offset: number; cpuType: number; original: string; replacement: string }> =
    [];
  const invalid = () => new Error(`Invalid Mach-O executable: ${relativePath}`);
  const inspectSlice = (start: number, size: number) => {
    if (size < 28 || start < 0 || start + size > bytes.length) throw invalid();
    const magic = bytes.readUInt32BE(start);
    if (!thinMagics.has(magic)) throw invalid();
    const little = magic === 0xcefaedfe || magic === 0xcffaedfe;
    const read = (offset: number) =>
      little ? bytes.readUInt32LE(start + offset) : bytes.readUInt32BE(start + offset);
    if (read(12) !== 2) return;
    const headerSize = magic === 0xfeedfacf || magic === 0xcffaedfe ? 32 : 28;
    const commandCount = read(16);
    const commandBytes = read(20);
    const end = headerSize + commandBytes;
    if (end > size || commandCount > commandBytes / 8) throw invalid();
    let offset = headerSize;
    let uuidOffset: number | undefined;
    for (let index = 0; index < commandCount; index++) {
      if (offset + 8 > end) throw invalid();
      const command = read(offset);
      const commandSize = read(offset + 4);
      if (commandSize < 8 || commandSize % 4 !== 0 || offset + commandSize > end) throw invalid();
      if (command === 0x1b) {
        if (commandSize !== 24 || uuidOffset !== undefined) throw invalid();
        uuidOffset = start + offset + 8;
      }
      offset += commandSize;
    }
    if (offset !== end || uuidOffset === undefined) throw invalid();
    const original = bytes.subarray(uuidOffset, uuidOffset + 16);
    const replacement = NodeCrypto.createHash("sha256")
      .update(`t3code-executable-v1\0${bundleId}\0${relativePath}\0${read(4)}\0${read(8)}\0`)
      .update(original)
      .digest()
      .subarray(0, 16);
    replacement[6] = (replacement[6]! & 0x0f) | 0x80;
    replacement[8] = (replacement[8]! & 0x3f) | 0x80;
    patches.push({
      offset: uuidOffset,
      cpuType: read(4),
      original: formatUuid(original),
      replacement: formatUuid(replacement),
    });
  };

  if (bytes.length >= 4) {
    const magic = bytes.readUInt32BE(0);
    if (thinMagics.has(magic)) {
      inspectSlice(0, bytes.length);
    } else if (fatMagics.has(magic)) {
      if (bytes.length < 8) throw invalid();
      const little = magic === 0xbebafeca || magic === 0xbfbafeca;
      const read = (offset: number) =>
        little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
      const fat64 = magic === 0xcafebabf || magic === 0xbfbafeca;
      const entrySize = fat64 ? 32 : 20;
      const count = read(4);
      const tableEnd = 8 + count * entrySize;
      if (count === 0 || tableEnd > bytes.length) throw invalid();
      const readOffset = (offset: number) => {
        const value = fat64
          ? Number(little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset))
          : read(offset);
        if (!Number.isSafeInteger(value)) throw invalid();
        return value;
      };
      const slices = Array.from({ length: count }, (_, index) => {
        const entry = 8 + index * entrySize;
        return {
          start: readOffset(entry + 8),
          size: readOffset(entry + (fat64 ? 16 : 12)),
        };
      }).sort((left, right) => left.start - right.start);
      let previousEnd = tableEnd;
      for (const slice of slices) {
        if (slice.start < previousEnd) throw invalid();
        inspectSlice(slice.start, slice.size);
        previousEnd = slice.start + slice.size;
      }
    }
  }

  const binary = patches.length === 0 ? bytes : NodeBuffer.Buffer.from(bytes);
  for (const patch of patches) {
    NodeBuffer.Buffer.from(patch.replacement.replaceAll("-", ""), "hex").copy(binary, patch.offset);
  }
  return {
    binary,
    uuids: patches.map(({ cpuType, original, replacement }) => ({
      cpuType,
      original,
      replacement,
    })),
  };
}

async function readBundle(app: string) {
  const info = Plist.parse(
    await NodeFSP.readFile(NodePath.join(app, "Contents/Info.plist"), "utf8"),
  );
  if (
    typeof info !== "object" ||
    info === null ||
    Array.isArray(info) ||
    !("CFBundleIdentifier" in info) ||
    !("CFBundleExecutable" in info) ||
    typeof info.CFBundleIdentifier !== "string" ||
    typeof info.CFBundleExecutable !== "string" ||
    NodePath.basename(info.CFBundleExecutable) !== info.CFBundleExecutable
  )
    throw new Error(`Invalid app identity: ${app}`);
  return { id: info.CFBundleIdentifier, executable: info.CFBundleExecutable };
}

async function* regularFiles(directory: string): AsyncGenerator<string> {
  for (const entry of (await NodeFSP.readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const file = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) yield* regularFiles(file);
    else if (entry.isFile()) yield file;
  }
}

export async function prepareMacAppIdentity(app: string, expectedBundleId: string) {
  const identity = await readBundle(app);
  if (identity.id !== expectedBundleId)
    throw new Error(`Unexpected app identifier: ${identity.id}`);
  const mapPath = NodePath.join(app, "Contents/Resources", UUID_MAP);
  // A second pass would hash already-namespaced UUIDs. Require fresh packaging inputs.
  if (
    await NodeFSP.stat(mapPath).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    )
  )
    throw new Error(`App identity is already prepared: ${app}`);
  const mappings = [];
  for await (const file of regularFiles(NodePath.join(app, "Contents"))) {
    if (((await NodeFSP.stat(file)).mode & 0o111) === 0) continue;
    const handle = await NodeFSP.open(file, "r");
    const header = NodeBuffer.Buffer.alloc(4);
    try {
      const { bytesRead } = await handle.read(header, 0, 4, 0);
      if (
        bytesRead !== 4 ||
        (!thinMagics.has(header.readUInt32BE(0)) && !fatMagics.has(header.readUInt32BE(0)))
      )
        continue;
    } finally {
      await handle.close();
    }
    const relativePath = NodePath.relative(app, file).split(NodePath.sep).join("/");
    const result = rewriteExecutableUuids(await NodeFSP.readFile(file), identity.id, relativePath);
    if (result.uuids.length === 0) continue;
    await NodeFSP.writeFile(file, result.binary);
    mappings.push({ path: relativePath, uuids: result.uuids });
  }
  if (!mappings.some((entry) => entry.path === `Contents/MacOS/${identity.executable}`)) {
    throw new Error(`Main executable has no build UUID: ${app}`);
  }
  // Keep the vendor UUIDs available for interpreting crash reports against upstream symbols.
  await NodeFSP.writeFile(
    mapPath,
    `${JSON.stringify({ bundleId: identity.id, executables: mappings }, null, 2)}\n`,
  );
  return mappings.map((entry) => NodePath.join(app, entry.path));
}

export async function verifyMacAppIdentity(app: string) {
  await execute("codesign", ["--verify", "--deep", "--strict", app]);
  const bundles = [app];
  for await (const file of regularFiles(NodePath.join(app, "Contents"))) {
    if (file.endsWith(`${NodePath.sep}Contents${NodePath.sep}Info.plist`)) {
      const bundle = NodePath.dirname(NodePath.dirname(file));
      if (bundle.endsWith(".app")) bundles.push(bundle);
    }
  }
  for (const bundle of bundles) {
    const identity = await readBundle(bundle);
    const { stderr } = await execute("codesign", ["--display", "--verbose=4", bundle]);
    if (
      !stderr.split("\n").includes(`Identifier=${identity.id}`) ||
      stderr.includes("Info.plist=not bound") ||
      !/^Sealed Resources version=/m.test(stderr)
    )
      throw new Error(`App signature does not bind its bundle identity: ${bundle}`);
  }
}
