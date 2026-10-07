import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPlatformShakingUseDirectImport } from "./rn-platform-shaking-use-direct-import.js";

describe("react-native/rn-platform-shaking-use-direct-import", () => {
  it("flags Platform access through a React Native namespace", () => {
    const result = runRule(
      rnPlatformShakingUseDirectImport,
      'import * as ReactNative from "react-native";\nconst platform = ReactNative.Platform.OS;',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a direct Platform import", () => {
    const result = runRule(
      rnPlatformShakingUseDirectImport,
      'import { Platform } from "react-native";\nconst platform = Platform.OS;',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows namespace imports from other modules", () => {
    const result = runRule(
      rnPlatformShakingUseDirectImport,
      'import * as ReactNative from "./react-native-adapter";\nconst platform = ReactNative.Platform.OS;',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows a shadowed namespace name", () => {
    const result = runRule(
      rnPlatformShakingUseDirectImport,
      'import * as ReactNative from "react-native";\nconst read = (ReactNative) => ReactNative.Platform.OS;',
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
