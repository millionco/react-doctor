import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPreferExpoImage } from "./rn-prefer-expo-image.js";

const expoSettings = { "react-doctor": { framework: "expo" } } as const;

describe("react-native/rn-prefer-expo-image — regressions", () => {
  it("stays silent on a type-only declaration import", () => {
    const result = runRule(rnPreferExpoImage, `import type { Image } from "react-native";`, {
      filename: "App.tsx",
      settings: expoSettings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline type-only specifier", () => {
    const result = runRule(rnPreferExpoImage, `import { type Image } from "react-native";`, {
      filename: "App.tsx",
      settings: expoSettings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value import of Image", () => {
    const result = runRule(rnPreferExpoImage, `import { Image } from "react-native";`, {
      filename: "App.tsx",
      settings: expoSettings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
