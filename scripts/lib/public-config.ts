// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap reads optional root env files before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import type { Plugin } from "vite-plus";

export interface T3CodePublicConfig {
  readonly clerkPublishableKey: string | undefined;
  readonly clerkJwtTemplate: string | undefined;
  readonly clerkCliOAuthClientId: string | undefined;
  readonly relayUrl: string | undefined;
}

type Environment = Readonly<Record<string, string | undefined>>;

const REPO_ROOT = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../../..");

const DISABLED_CLIENT_TRACING_PREFIXES = [
  "T3FORK_MOBILE_OTLP_",
  "EXPO_PUBLIC_OTLP_",
  "T3FORK_RELAY_CLIENT_OTLP_",
  "VITE_RELAY_OTLP_",
];

export function removeClientTracingEnv(env: Record<string, unknown>) {
  for (const name of Object.keys(env)) {
    if (DISABLED_CLIENT_TRACING_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix))) {
      delete env[name];
    }
  }
}

export const clientTracingDisabledPlugin = {
  name: "fork-no-client-tracing-env",
  enforce: "post",
  configResolved(config) {
    // Vite loads mode-specific env files after the build config has evaluated.
    removeClientTracingEnv(config.env);
  },
} satisfies Plugin;

export function loadRepoEnv({
  baseEnv = process.env,
  repoRoot = REPO_ROOT,
}: {
  readonly baseEnv?: Environment;
  readonly repoRoot?: string;
} = {}): Record<string, string | undefined> {
  const rootEnv = readEnvFile(NodePath.join(repoRoot, ".env"));
  const localEnv = readEnvFile(NodePath.join(repoRoot, ".env.local"));
  const config = resolvePublicConfig(baseEnv, localEnv, rootEnv);

  const env = { ...rootEnv, ...localEnv, ...baseEnv };
  removeClientTracingEnv(env);

  return {
    ...env,
    ...(config.clerkPublishableKey
      ? {
          T3FORK_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          VITE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
        }
      : {}),
    ...(config.clerkJwtTemplate
      ? {
          T3FORK_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          VITE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          EXPO_PUBLIC_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
        }
      : {}),
    ...(config.clerkCliOAuthClientId
      ? {
          T3FORK_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
          VITE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
        }
      : {}),
    ...(config.relayUrl
      ? {
          T3FORK_RELAY_URL: config.relayUrl,
          VITE_T3FORK_RELAY_URL: config.relayUrl,
        }
      : {}),
  };
}

export function applyRepoEnv({
  env = process.env,
  repoRoot = REPO_ROOT,
}: {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
} = {}) {
  const configured = loadRepoEnv({ baseEnv: env, repoRoot });
  removeClientTracingEnv(env);
  Object.assign(env, configured);
  return configured;
}

function resolvePublicConfig(...sources: readonly Environment[]): T3CodePublicConfig {
  return {
    clerkPublishableKey: firstNonEmpty(
      sources,
      "T3FORK_CLERK_PUBLISHABLE_KEY",
      "VITE_CLERK_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    ),
    clerkJwtTemplate: firstNonEmpty(
      sources,
      "T3FORK_CLERK_JWT_TEMPLATE",
      "VITE_CLERK_JWT_TEMPLATE",
      "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
    ),
    clerkCliOAuthClientId: firstNonEmpty(
      sources,
      "T3FORK_CLERK_CLI_OAUTH_CLIENT_ID",
      "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
    ),
    relayUrl: firstNonEmpty(sources, "T3FORK_RELAY_URL", "VITE_T3FORK_RELAY_URL"),
  };
}

function firstNonEmpty(sources: readonly Environment[], ...names: readonly string[]) {
  for (const source of sources) {
    for (const name of names) {
      const value = source[name]?.trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function readEnvFile(path: string): Record<string, string | undefined> {
  return NodeFS.existsSync(path) ? NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8")) : {};
}
