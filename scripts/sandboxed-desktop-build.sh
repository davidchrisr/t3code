#!/bin/bash
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: scripts/sandboxed-desktop-build.sh [--arch arm64|x64|universal] [--check] [-- COMMAND ...]

Build a local macOS .app using an isolated source copy and sandboxed host tools.
--check verifies the isolation boundary without installing dependencies or building.
COMMAND runs after a frozen desktop dependency install, in place of the artifact build.
Build state and logs are retained under .local/scratch/macos-build/.
Artifacts are written to release/sandboxed-macos/<run>/.
Requires macOS, Xcode Command Line Tools, Node, vp, and rustup with the target installed.
EOF
}

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v -- "$1" || fail "Required command not found: $1"
}

run_sandbox() {
  /usr/bin/env -i "${build_env[@]}" /usr/bin/sandbox-exec "${sandbox_args[@]}" "$@"
}

run_logged() {
  local log_path=$1
  shift
  # Opening a child-controlled log path must happen under the same policy.
  run_sandbox "$@" 2>&1 | run_sandbox /usr/bin/tee -a "$log_path"
}

ensure_bootstrap_directory() {
  [[ ! -L $1 ]] || fail "Refusing symlinked build directory: $1"
  if [[ -e $1 ]]; then
    [[ -d $1 ]] || fail "Build directory is not a directory: $1"
  else
    mkdir -- "$1"
  fi
}

main() {
  local arch='' check=0 arch_seen=0
  local -a command_args=()
  while [[ $# -gt 0 ]]; do
    case $1 in
      --help)
        usage
        return
        ;;
      --arch)
        [[ $arch_seen == 0 && $# -ge 2 ]] || {
          usage >&2
          exit 2
        }
        case $2 in
          arm64 | x64 | universal) arch=$2 ;;
          *)
            usage >&2
            exit 2
            ;;
        esac
        arch_seen=1
        shift 2
        ;;
      --check)
        [[ $check == 0 ]] || {
          usage >&2
          exit 2
        }
        check=1
        shift
        ;;
      --)
        shift
        [[ $# -gt 0 && $1 != -* ]] || {
          usage >&2
          exit 2
        }
        command_args=("$@")
        break
        ;;
      *)
        usage >&2
        exit 2
        ;;
    esac
  done
  [[ $check == 0 || ${#command_args[@]} == 0 ]] || {
    usage >&2
    exit 2
  }
  [[ $(uname -s) == Darwin ]] || fail 'This build requires macOS.'

  local script_path script_dir project_dir build_root cache_dir run_dir probe_dir output_dir
  local os_temp_root temp_alias_root
  script_path=$(realpath -- "${BASH_SOURCE[0]}")
  script_dir=$(dirname "$script_path")
  project_dir=$(dirname "$script_dir")
  local dependency
  for dependency in sandbox-exec realpath mktemp rsync xcode-select getconf; do
    require_command "$dependency" >/dev/null
  done

  local node_path vp_path cargo_path developer_dir developer_root rustup_root homebrew_prefix
  developer_dir=$(xcode-select -p)
  developer_dir=$(realpath -- "$developer_dir")
  case $developer_dir in
    */Contents/Developer) developer_root=${developer_dir%/Developer} ;;
    *) developer_root=$developer_dir ;;
  esac
  # --check deliberately works before the third-party toolchain is installed.
  node_path=/usr/bin/false
  vp_path=/usr/bin/false
  cargo_path=/usr/bin/false
  rustup_root=$project_dir/.local/scratch/macos-build/cache/rustup-unused
  homebrew_prefix=$project_dir/.local/scratch/macos-build/cache/homebrew-unused
  if [[ $check == 0 ]]; then
    node_path=$(require_command node)
    node_path=$(realpath -- "$node_path")
    vp_path=$(require_command vp)
    vp_path=$(realpath -- "$vp_path")
    cargo_path=$(require_command cargo)
    cargo_path=$(realpath -- "$cargo_path")
    require_command rustc >/dev/null
    require_command rustup >/dev/null
    require_command git >/dev/null
    rustup_root=$(realpath -- "${RUSTUP_HOME:-$HOME/.rustup}")
    local tool_path
    for tool_path in "$node_path" "$vp_path" "$cargo_path"; do
      case $tool_path in
        */Cellar/*) homebrew_prefix=${tool_path%%/Cellar/*} ;;
      esac
    done
  fi
  if [[ -z $arch ]]; then
    case $(uname -m) in
      arm64) arch=arm64 ;;
      x86_64) arch=x64 ;;
      *) fail 'Unsupported macOS host architecture.' ;;
    esac
  fi

  # These parents stay outside child write grants, including across runs.
  local bootstrap_path
  for bootstrap_path in "$project_dir/.local" "$project_dir/.local/scratch" \
    "$project_dir/.local/scratch/macos-build" "$project_dir/.local/scratch/macos-build/runs" \
    "$project_dir/.local/scratch/macos-build/cache" "$project_dir/.local/scratch/macos-build-probes" \
    "$project_dir/release" "$project_dir/release/sandboxed-macos"; do
    ensure_bootstrap_directory "$bootstrap_path"
  done
  build_root=$project_dir/.local/scratch/macos-build
  cache_dir=$build_root/cache
  # Create once without truncating a pre-existing file or following a symlink.
  local package_scope=$build_root/package.json
  if [[ -e $package_scope || -L $package_scope ]]; then
    [[ -f $package_scope && ! -L $package_scope ]] || fail "Unsafe package-scope file: $package_scope"
    [[ $(cat -- "$package_scope") == '{"private":true}' ]] || fail "Unexpected package-scope file: $package_scope"
  else
    (
      set -C
      printf '{"private":true}\n' >"$package_scope"
    )
  fi
  run_dir=$(mktemp -d "$build_root/runs/run.XXXXXX")
  probe_dir=$(mktemp -d "$project_dir/.local/scratch/macos-build-probes/probe.XXXXXX")
  output_dir=$project_dir/release/sandboxed-macos/${run_dir##*/}
  mkdir -- "$run_dir/home" "$run_dir/tmp" "$run_dir/source" "$output_dir"
  output_dir=$(realpath -- "$output_dir")
  # ASAR unpack globs skip hidden path components. Keep the data local while
  # giving packaging tools a non-hidden temporary path through a private alias.
  os_temp_root=$(getconf DARWIN_USER_TEMP_DIR)
  os_temp_root=$(realpath -- "$os_temp_root")
  temp_alias_root=$(mktemp -d "$os_temp_root/t3code-build.XXXXXX")
  ln -s "$run_dir/tmp" "$temp_alias_root/tmp"
  printf '%s\n' "$temp_alias_root" >"$run_dir/temp-alias"
  printf 'outside sandbox\n' >"$probe_dir/denied"

  local -a sandbox_args=(
    -f "$script_dir/sandbox/desktop-build.sb"
    -D "BUILD_ROOT=$build_root" -D "RUN_DIR=$run_dir" -D "CACHE_DIR=$cache_dir" -D "OUTPUT_DIR=$output_dir"
    -D "DEVELOPER_ROOT=$developer_root" -D "NODE_DIR=$(dirname "$node_path")"
    -D "VP_DIR=$(dirname "$vp_path")" -D "CARGO_BIN_DIR=$(dirname "$cargo_path")"
    -D "RUSTUP_HOME=$rustup_root" -D "HOMEBREW_PREFIX=$homebrew_prefix"
  )
  local -a build_env=(
    "PATH=$(dirname "$vp_path"):$(dirname "$node_path"):$(dirname "$cargo_path"):/usr/bin:/bin:/usr/sbin:/sbin"
    "HOME=$run_dir/home" "TMPDIR=$temp_alias_root/tmp" "TMP=$temp_alias_root/tmp" "TEMP=$temp_alias_root/tmp"
    "VP_HOME=$cache_dir/vp" "CARGO_HOME=$cache_dir/cargo" "RUSTUP_HOME=$rustup_root"
    'RUSTUP_AUTO_INSTALL=0' "DEVELOPER_DIR=$developer_dir"
    "XDG_CACHE_HOME=$cache_dir/xdg" "XDG_CONFIG_HOME=$run_dir/home/.config"
    "XDG_DATA_HOME=$run_dir/home/.local/share" "XDG_STATE_HOME=$run_dir/home/.local/state"
    "XDG_RUNTIME_DIR=$cache_dir/runtime"
    "npm_config_store_dir=$cache_dir/pnpm" "npm_config_cache=$cache_dir/npm"
    "pnpm_config_store_dir=$cache_dir/pnpm" "pnpm_config_cache_dir=$cache_dir/pnpm-cache"
    "GIT_CEILING_DIRECTORIES=$build_root"
    "ELECTRON_CACHE=$cache_dir/electron" "ELECTRON_BUILDER_CACHE=$cache_dir/electron-builder"
    'CI=1' 'LANG=en_US.UTF-8' 'TERM=dumb' 'NO_COLOR=1'
  )
  if [[ -n ${RUSTUP_TOOLCHAIN:-} ]]; then
    build_env+=("RUSTUP_TOOLCHAIN=$RUSTUP_TOOLCHAIN")
  fi

  printf 'Build workspace: %s\nOutput: %s\nIsolation fixture: %s\nTemporary alias: %s\n' \
    "$run_dir" "$output_dir" "$probe_dir" "$temp_alias_root/tmp"
  cd "$run_dir"
  # Cached descendants can contain child-created links. Resolve all writes in the sandbox.
  run_logged "$run_dir/setup.log" /bin/mkdir -p \
    "$cache_dir/vp" "$cache_dir/pnpm" "$cache_dir/pnpm-cache" "$cache_dir/runtime" "$cache_dir/cargo" "$cache_dir/electron" \
    "$cache_dir/electron-builder" "$cache_dir/xdg" "$cache_dir/npm"
  run_sandbox /bin/ln -s "$probe_dir/denied" "$run_dir/log-symlink"
  if run_logged "$run_dir/log-symlink" /bin/echo 'must not escape' >/dev/null 2>&1; then
    fail 'Isolation failed: log writer can follow a symlink outside the build'
  fi
  [[ $(cat -- "$probe_dir/denied") == 'outside sandbox' ]] || fail 'Isolation failed: log writer changed an outside file'
  # Exercise a subprocess as well as the parent shell before running package scripts.
  # shellcheck disable=SC2016 # These variables expand in the sandboxed child shells.
  T3CODE_SANDBOX_PROBE_PARENT=parent-only run_logged "$run_dir/isolation.log" /bin/sh -eu -c '
    if [ "${T3CODE_SANDBOX_PROBE_PARENT+x}" = x ]; then
      printf "Isolation failed: parent environment leaked into the child\n" >&2; exit 1
    fi
    printf "allowed\n" > "$1/probe"
    if /bin/cat "$2/denied" >/dev/null 2>&1; then
      printf "Isolation failed: outside files are readable\n" >&2; exit 1
    fi
    if /bin/sh -c '\''printf "changed\n" >> "$1/denied"'\'' sh "$2" 2>/dev/null; then
      printf "Isolation failed: subprocess can write outside the build\n" >&2; exit 1
    fi
    if /bin/cat "$3/package.json" >/dev/null 2>&1; then
      printf "Isolation failed: original checkout is readable\n" >&2; exit 1
    fi
    if /bin/sh -c '\''printf "changed\n" >> "$1/package.json"'\'' sh "$4" 2>/dev/null; then
      printf "Isolation failed: shared bootstrap file is writable\n" >&2; exit 1
    fi
    printf "Isolation checks passed\n"
  ' sh "$run_dir" "$probe_dir" "$project_dir" "$build_root"
  [[ $check == 0 ]] || return 0

  local commit_hash
  commit_hash=$(git -C "$project_dir" rev-parse --verify HEAD)
  build_env+=("T3CODE_COMMIT_HASH=$commit_hash")
  git -C "$project_dir" ls-files -z --cached --others --exclude-standard --deduplicate \
    -- . ':!.repos' ':!git_old' ':!.local' \
    >"$run_dir/source-files.all"
  local source_file
  while IFS= read -r -d '' source_file; do
    # Filter before --files-from: rsync may create implied parent directories
    # even when a directory exclusion would have pruned a recursive traversal.
    case /$source_file/ in
      */.git/* | */git_old/* | */.local/* | */.repos/* | */.t3/* | */.codex/* | */.aws/* | */.agents/* | \
        */.env*/* | */.npmrc/* | */node_modules/* | */dist/* | */dist-electron/* | */dist-exe/* | \
        */target/* | */release/* | */release-mock/* | */.vite-plus/* | */.turbo/*) continue ;;
    esac
    # Tracked deletions stay deleted; symlinks are copied without following them.
    if [[ -e "$project_dir/$source_file" || -L "$project_dir/$source_file" ]]; then
      printf '%s\0' "$source_file"
    fi
  done <"$run_dir/source-files.all" >"$run_dir/source-files"
  rsync -a --from0 --files-from="$run_dir/source-files" "$project_dir/" "$run_dir/source/"
  cd "$run_dir/source"
  local node_version
  node_version=$(run_sandbox "$node_path" -e '
    if (Number(process.versions.node.split(".")[0]) !== 24) {
      console.error("This checkout requires Node 24. Put a compatible Node on PATH before building.");
      process.exit(1);
    }
    process.stdout.write(process.versions.node);
  ')
  build_env+=("VP_NODE_VERSION=$node_version")
  run_logged "$run_dir/toolchain.log" cargo --version
  run_logged "$run_dir/toolchain.log" rustc --version
  run_logged "$run_dir/install.log" "$vp_path" install --frozen-lockfile \
    --filter=@t3tools/desktop... --filter=t3... --filter=@t3tools/scripts... \
    --filter=@t3tools/oxlint-plugin-t3code...
  if [[ ${#command_args[@]} -gt 0 ]]; then
    run_logged "$run_dir/command.log" "${command_args[@]}"
  else
    run_logged "$run_dir/build.log" "$vp_path" run dist:desktop:artifact --platform mac --target dir \
      --arch "$arch" --output-dir "$output_dir" --keep-stage --verbose
  fi
}

main "$@"
