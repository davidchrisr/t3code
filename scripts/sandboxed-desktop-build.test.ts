// @effect-diagnostics nodeBuiltinImport:off - Shell fixtures exercise discovery without a macOS toolchain.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "@effect/vitest";

const wrapper = NodeURL.fileURLToPath(
  new URL("./sandboxed-desktop-build.sh", import.meta.url),
);
const repository = NodePath.dirname(NodePath.dirname(wrapper));

function fixture() {
  const parent = NodePath.join(repository, ".local/tmp/mac-build-path-tests");
  NodeFS.mkdirSync(parent, { recursive: true });
  const root = NodeFS.mkdtempSync(NodePath.join(parent, "case-"));
  const primary = NodePath.join(root, "original checkout");
  const worktree = NodePath.join(root, "agent checkout");
  const foreign = NodePath.join(root, "unrelated checkout");
  const bin = NodePath.join(root, "bin");
  for (const directory of [
    NodePath.join(primary, ".git"),
    worktree,
    NodePath.join(foreign, ".git"),
    bin,
  ]) {
    NodeFS.mkdirSync(directory, { recursive: true });
  }
  NodeFS.writeFileSync(
    NodePath.join(bin, "git"),
    `#!/bin/sh
case "$4" in
  --show-toplevel) printf '%s\\n' "$2" ;;
  --path-format=absolute)
    if [ "$2" = "$TEST_FOREIGN_SOURCE" ]; then
      printf '%s\\n' "$TEST_FOREIGN_SOURCE/.git"
    else
      printf '%s\\n' "$TEST_COMMON_DIR"
    fi ;;
  *) exit 2 ;;
esac
`,
    { mode: 0o755 },
  );
  const run = (...args: string[]) =>
    NodeChildProcess.spawnSync("bash", [wrapper, ...args], {
      cwd: worktree,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        TEST_COMMON_DIR: NodePath.join(primary, ".git"),
        TEST_FOREIGN_SOURCE: foreign,
      },
      encoding: "utf8",
    });
  return { primary, worktree, foreign, run };
}

describe("sandboxed desktop build paths", () => {
  it("shares tools and cache while selecting private roots from the source checkout", () => {
    const { primary, worktree, run } = fixture();
    const original = run("--worktree", primary, "--print-paths");
    const linked = run("--worktree", worktree, "--print-paths");
    expect(original.status, original.stderr).toBe(0);
    expect(linked.status, linked.stderr).toBe(0);
    for (const result of [original, linked]) {
      expect(result.stdout).toContain(
        `Shared cache: ${primary}/.local/scratch/macos-build/cache`,
      );
      expect(result.stdout).toContain(
        `Shared tools: ${primary}/.local/scratch/macos-build/tools`,
      );
    }
    expect(linked.stdout).toContain(`Source checkout: ${worktree}`);
    expect(linked.stdout).toContain(
      `Build root: ${worktree}/.local/scratch/macos-build`,
    );
    expect(linked.stdout).toContain(
      `Output root: ${worktree}/release/sandboxed-macos`,
    );
    expect(original.stdout).toContain(
      `Build root: ${primary}/.local/scratch/macos-build`,
    );
    expect(NodeFS.existsSync(NodePath.join(primary, ".local"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(worktree, ".local"))).toBe(false);
  });

  it("rejects a source from another repository before allocating files", () => {
    const { primary, foreign, run } = fixture();
    const result = run("--worktree", foreign, "--print-paths");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Selected checkout must share this wrapper repository",
    );
    expect(NodeFS.existsSync(NodePath.join(primary, ".local"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(foreign, ".local"))).toBe(false);
  });

  it.each([
    ["--worktree"],
    ["--worktree", ""],
    ["--worktree", "--check"],
    ["--worktree", ".", "--worktree", "."],
    ["--print-paths", "--check"],
    ["--print-paths", "--", "node"],
    ["--allow-downloads", "--allow-downloads"],
  ])(
    "rejects invalid arguments without allocating build directories: %j",
    (...args) => {
      const { primary, worktree, run } = fixture();
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Usage:");
      expect(NodeFS.existsSync(NodePath.join(primary, ".local"))).toBe(false);
      expect(NodeFS.existsSync(NodePath.join(worktree, ".local"))).toBe(false);
    },
  );
});
