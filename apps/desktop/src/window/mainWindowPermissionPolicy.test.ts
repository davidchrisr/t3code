import { expect, it } from "vitest";
import { isTrustedAppOrigin, mainWindowPermissionAllowed } from "./mainWindowPermissionPolicy.ts";

it("accepts app pages and rejects lookalike or opaque origins", () => {
  expect(isTrustedAppOrigin("t3code://app/threads/1", "t3code://app/")).toBe(true);
  expect(isTrustedAppOrigin("http://localhost:5733/threads/1", "http://localhost:5733/")).toBe(
    true,
  );
  for (const url of [
    "t3code://app.evil/",
    "https://app/",
    "null",
    "data:text/html,hello",
    "t3code://user@app/",
  ]) {
    expect(isTrustedAppOrigin(url, "t3code://app/")).toBe(false);
  }
  expect(isTrustedAppOrigin("http://localhost:5734/", "http://localhost:5733/")).toBe(false);
});

it("allows app media and writes while denying synchronous clipboard reads", () => {
  expect(mainWindowPermissionAllowed("media", "t3code://app/", "t3code://app/")).toBe(true);
  expect(mainWindowPermissionAllowed("media", "https://preview.example/", "t3code://app/")).toBe(
    false,
  );
  expect(
    mainWindowPermissionAllowed("deprecated-sync-clipboard-read", "t3code://app/", "t3code://app/"),
  ).toBe(false);
  expect(
    mainWindowPermissionAllowed("clipboard-sanitized-write", "t3code://app/", "t3code://app/"),
  ).toBe(true);
});

it.each(["clipboard-read", "local-fonts"])(
  "allows %s only for the trusted application origin",
  (permission) => {
    expect(mainWindowPermissionAllowed(permission, "t3code://app/threads/1", "t3code://app/")).toBe(
      true,
    );
    expect(
      mainWindowPermissionAllowed(
        permission,
        "http://localhost:5733/settings",
        "http://localhost:5733/",
      ),
    ).toBe(true);
    for (const url of [
      "https://preview.example/",
      "t3code://app.evil/",
      "t3code://user@app/",
      "null",
    ]) {
      expect(mainWindowPermissionAllowed(permission, url, "t3code://app/")).toBe(false);
    }
    expect(
      mainWindowPermissionAllowed(permission, "http://localhost:5734/", "http://localhost:5733/"),
    ).toBe(false);
  },
);
