const slug = "t3fork";

/** Installed macOS app identity; server state and the embedded client keep their existing names. */
export const MACOS_FORK_IDENTITY = {
  name: "T3 Fork",
  slug,
  appId: `com.t3tools.${slug}`,
} as const;
