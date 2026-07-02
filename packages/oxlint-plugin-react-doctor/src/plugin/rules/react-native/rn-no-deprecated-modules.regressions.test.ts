import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoDeprecatedModules } from "./rn-no-deprecated-modules.js";

describe("react-native/rn-no-deprecated-modules — regressions", () => {
  it("stays silent on a type-only declaration import", () => {
    const result = runRule(
      rnNoDeprecatedModules,
      `import type { SafeAreaView } from "react-native";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline type-only specifier", () => {
    const result = runRule(
      rnNoDeprecatedModules,
      `import { type SafeAreaView } from "react-native";`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import of a removed module", () => {
    const result = runRule(rnNoDeprecatedModules, `import { SafeAreaView } from "react-native";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
