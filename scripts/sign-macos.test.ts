import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { expect, it, vi } from "vite-plus/test";

import { prepareMacAppIdentity, verifyMacAppIdentity } from "./lib/macos-app-identity.ts";
import sign from "./sign-macos.ts";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));
vi.mock("./lib/macos-app-identity.ts", () => ({
  prepareMacAppIdentity: vi.fn(),
  verifyMacAppIdentity: vi.fn(),
}));

function setup() {
  const prepare = vi.mocked(prepareMacAppIdentity).mockReset();
  prepare.mockResolvedValue(["/build/T3 Fork.app/Contents/MacOS/T3 Fork"]);
  const signApplicationMock = vi.mocked(signApplication).mockReset();
  signApplicationMock.mockResolvedValue(undefined);
  const verify = vi.mocked(verifyMacAppIdentity).mockReset();
  verify.mockResolvedValue(undefined);
  return { prepare, signApplicationMock, verify };
}

it.each(["-", "Developer ID Application: Example-Team (ABC1234567)"])(
  "uses ad-hoc signing when the builder supplies %s for a local build",
  async (identity) => {
    const { signApplicationMock } = setup();
    await sign(
      { app: "/build/T3 Fork.app", identity, identityValidation: false },
      { platformSpecificBuildOptions: { identity: "-" } },
    );
    expect(signApplicationMock).toHaveBeenCalledExactlyOnceWith({
      app: "/build/T3 Fork.app",
      identity: "-",
      identityValidation: false,
      preAutoEntitlements: false,
      batchCodesignCalls: true,
    });
  },
);

it("preserves certificate signing options and caller-supplied binaries", async () => {
  const { signApplicationMock } = setup();
  const options: SignOptions = {
    app: "/build/T3 Fork.app",
    identity: "certificate-hash",
    identityValidation: false,
    keychain: "/build/signing.keychain",
    provisioningProfile: "/build/profile.provisionprofile",
    preAutoEntitlements: true,
    binaries: ["/build/extra-helper"],
    optionsForFile: () => ({ hardenedRuntime: true }),
  };
  await sign(options, { platformSpecificBuildOptions: {} });
  expect(signApplicationMock).toHaveBeenCalledExactlyOnceWith({
    ...options,
    batchCodesignCalls: true,
  });
});

it("stops packaging when signing fails without verifying an unfinished signature", async () => {
  const { signApplicationMock, verify } = setup();
  const error = new Error("Signing failed");
  signApplicationMock.mockRejectedValue(error);
  await expect(
    sign(
      { app: "/build/T3 Fork.app", identity: "-" },
      { platformSpecificBuildOptions: { identity: "-" } },
    ),
  ).rejects.toBe(error);
  expect(verify).not.toHaveBeenCalled();
});
