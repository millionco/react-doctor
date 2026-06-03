import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoLegacyExpoPackages } from "./rn-no-legacy-expo-packages.js";

describe("rn-no-legacy-expo-packages", () => {
  it("flags legacy expo-av imports", () => {
    const code = `
      import { Audio } from "expo-av";
      export const sound = new Audio.Sound();
    `;
    const result = runRule(rnNoLegacyExpoPackages, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("expo-av");
  });

  it("flags legacy expo-av subpath imports", () => {
    const code = `
      import { Audio } from "expo-av/build/Audio";
      export const sound = Audio;
    `;
    const result = runRule(rnNoLegacyExpoPackages, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag current expo-linear-gradient imports", () => {
    const code = `
      import { LinearGradient } from "expo-linear-gradient";
      export const Gradient = () => <LinearGradient colors={["red", "blue"]} />;
    `;
    const result = runRule(rnNoLegacyExpoPackages, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag current expo-linear-gradient subpath imports", () => {
    const code = `
      import LinearGradient from "expo-linear-gradient/build/LinearGradient";
      export const Gradient = LinearGradient;
    `;
    const result = runRule(rnNoLegacyExpoPackages, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
