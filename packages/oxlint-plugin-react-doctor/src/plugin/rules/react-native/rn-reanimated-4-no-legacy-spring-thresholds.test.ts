import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnReanimated4NoLegacySpringThresholds } from "./rn-reanimated-4-no-legacy-spring-thresholds.js";

describe("react-native/rn-reanimated-4-no-legacy-spring-thresholds", () => {
  it("flags both legacy thresholds in a static config", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `import { withSpring } from "react-native-reanimated";
      withSpring(1, { restDisplacementThreshold: 0.01, restSpeedThreshold: 2 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0].message).toContain("energyThreshold");
    expect(result.diagnostics[1].message).toContain("energyThreshold");
  });

  it("resolves renamed imports and computed static option names", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `import { withSpring as spring } from "react-native-reanimated";
      spring(1, { ["restSpeedThreshold"]: 2 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("restSpeedThreshold");
  });

  it("resolves a namespace member and const alias", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `import * as Reanimated from "react-native-reanimated";
      const spring = Reanimated.withSpring;
      spring(1, ({ restDisplacementThreshold: 0.01 }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on energyThreshold", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `import { withSpring } from "react-native-reanimated";
      withSpring(1, { energyThreshold: 0.001 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the config is not statically visible", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `import { withSpring } from "react-native-reanimated";
      const springConfig = { restSpeedThreshold: 2 };
      withSpring(1, springConfig);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on dynamic option keys", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `import { withSpring } from "react-native-reanimated";
      const optionName = "restSpeedThreshold";
      withSpring(1, { [optionName]: 2 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a same-named local helper", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `const withSpring = (value, config) => ({ value, config });
      withSpring(1, { restSpeedThreshold: 2 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an imported withSpring is shadowed", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `import { withSpring } from "react-native-reanimated";
      const Component = () => {
        const withSpring = (value, config) => ({ value, config });
        return withSpring(1, { restSpeedThreshold: 2 });
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on withSpring imported from another module", () => {
    const result = runRule(
      rnReanimated4NoLegacySpringThresholds,
      `import { withSpring } from "./spring";
      withSpring(1, { restSpeedThreshold: 2 });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
