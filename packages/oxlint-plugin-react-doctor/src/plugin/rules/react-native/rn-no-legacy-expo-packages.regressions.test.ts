import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { LEGACY_EXPO_PACKAGE_REPLACEMENTS } from "../../constants/react-native.js";
import { rnNoLegacyExpoPackages } from "./rn-no-legacy-expo-packages.js";

const [legacyPackageName] = [...LEGACY_EXPO_PACKAGE_REPLACEMENTS.keys()];

describe("react-native/rn-no-legacy-expo-packages — regressions", () => {
  it("stays silent on a type-only import from a legacy Expo package", () => {
    const result = runRule(
      rnNoLegacyExpoPackages,
      `import type { Foo } from "${legacyPackageName}";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import from a legacy Expo package", () => {
    const result = runRule(rnNoLegacyExpoPackages, `import { Foo } from "${legacyPackageName}";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
