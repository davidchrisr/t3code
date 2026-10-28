export function isTrustedAppOrigin(requestingUrl: string, appUrl: string): boolean {
  try {
    const candidate = new URL(requestingUrl);
    const app = new URL(appUrl);
    return (
      candidate.protocol === app.protocol &&
      candidate.host === app.host &&
      candidate.username === "" &&
      candidate.password === ""
    );
  } catch {
    return false;
  }
}

export function mainWindowPermissionAllowed(
  permission: string,
  requestingUrl: string,
  appUrl: string,
): boolean {
  if (!isTrustedAppOrigin(requestingUrl, appUrl)) return false;
  return (
    permission === "media" ||
    permission === "clipboard-read" ||
    permission === "clipboard-sanitized-write" ||
    permission === "local-fonts" ||
    permission === "fullscreen" ||
    permission === "notifications"
  );
}
