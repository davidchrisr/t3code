import { assert, it } from "@effect/vitest";
import {
  WINDOWS_POLICY_GROUPS,
  WINDOWS_POLICY_LISTS,
  WINDOWS_POLICY_VALUES,
} from "@t3tools/shared/managedPolicyFile";

import { macosProfile, windowsAdmx, windowsAdml } from "./policyTemplates.ts";

it("generates fork policy templates matching the native readers", () => {
  const admx = windowsAdmx();
  assert.include(admx, 'namespace="T3Tools.Policies.T3Fork"');
  assert.include(windowsAdml(), 'id="T3Fork"');
  const profile = macosProfile(
    { schemaVersion: 1, organization: "Example Corp" },
    { profile: "profile-uuid", payload: "payload-uuid" },
  );
  assert.equal(profile._tag, "Valid");
  if (profile._tag === "Valid") {
    assert.include(profile.profile, "<string>com.t3tools.t3fork</string>");
    assert.notInclude(profile.profile, "com.t3tools.t3code");
  }
  for (const name of Object.keys(WINDOWS_POLICY_VALUES)) {
    assert.include(admx, `valueName="${name}"`);
  }
  for (const key of Object.keys(WINDOWS_POLICY_LISTS)) {
    assert.include(admx, `key="SOFTWARE\\Policies\\T3Tools\\T3Fork\\${key}"`);
  }
  for (const name of Object.keys(WINDOWS_POLICY_GROUPS)) {
    assert.include(admx, `valueName="${name}"`);
  }
});

it("refuses a profile for a policy with a null value, which a plist cannot hold", () => {
  const profile = macosProfile(
    {
      schemaVersion: 1,
      organization: "Example Corp",
      settings: { defaultModelSelection: { value: null, locked: true } },
    },
    { profile: "profile-uuid", payload: "payload-uuid" },
  );
  assert.deepStrictEqual(profile, {
    _tag: "Invalid",
    reason:
      "settings.defaultModelSelection is null, which a configuration profile cannot hold; deploy this policy as a file.",
  });
});
