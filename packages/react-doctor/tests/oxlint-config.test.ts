import { describe, expect, it } from "vitest";
import { createOxlintConfig } from "../src/oxlint-config.js";

type OxlintConfig = ReturnType<typeof createOxlintConfig>;
type Rules = Record<string, string | undefined>;

const getRules = (config: OxlintConfig): Rules => config.rules as Rules;

describe("createOxlintConfig", () => {
  const baseOptions = {
    pluginPath: "/path/to/plugin.js",
    framework: "unknown" as const,
    hasReactCompiler: false,
  };

  describe("accessibility presets", () => {
    it("includes jsx-a11y plugin when accessibility is enabled", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "minimal",
      });
      expect(config.plugins).toContain("jsx-a11y");
    });

    it("excludes jsx-a11y plugin when accessibility is false", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: false,
      });
      expect(config.plugins).not.toContain("jsx-a11y");
    });

    it("includes minimal a11y rules for minimal preset", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "minimal",
      });
      const rules = getRules(config);

      // Core minimal rules
      expect(rules["jsx-a11y/alt-text"]).toBe("error");
      expect(rules["jsx-a11y/click-events-have-key-events"]).toBe("warn");
      expect(rules["jsx-a11y/no-static-element-interactions"]).toBe("warn");
      expect(rules["jsx-a11y/role-has-required-aria-props"]).toBe("error");

      // Rules NOT in minimal but in recommended
      expect(rules["jsx-a11y/mouse-events-have-key-events"]).toBeUndefined();
      expect(rules["jsx-a11y/aria-props"]).toBeUndefined();
    });

    it("includes all recommended a11y rules for recommended preset", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "recommended",
      });
      const rules = getRules(config);

      // All minimal rules should be present
      expect(rules["jsx-a11y/alt-text"]).toBe("error");
      expect(rules["jsx-a11y/click-events-have-key-events"]).toBe("warn");

      // Additional recommended rules
      expect(rules["jsx-a11y/mouse-events-have-key-events"]).toBe("warn");
      expect(rules["jsx-a11y/aria-props"]).toBe("warn");
      expect(rules["jsx-a11y/aria-proptypes"]).toBe("warn");
      expect(rules["jsx-a11y/interactive-supports-focus"]).toBe("warn");

      // Rules NOT in recommended but in strict
      expect(rules["jsx-a11y/anchor-ambiguous-text"]).toBeUndefined();
      expect(rules["jsx-a11y/control-has-associated-label"]).toBeUndefined();
    });

    it("includes all strict a11y rules with error severity for strict preset", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "strict",
      });
      const rules = getRules(config);

      // All rules should be errors in strict mode
      expect(rules["jsx-a11y/alt-text"]).toBe("error");
      expect(rules["jsx-a11y/click-events-have-key-events"]).toBe("error");
      expect(rules["jsx-a11y/mouse-events-have-key-events"]).toBe("error");
      expect(rules["jsx-a11y/aria-props"]).toBe("error");

      // Strict-only rules
      expect(rules["jsx-a11y/anchor-ambiguous-text"]).toBe("error");
      expect(rules["jsx-a11y/control-has-associated-label"]).toBe("error");
    });

    it("excludes all a11y rules when accessibility is false", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: false,
      });
      const rules = getRules(config);

      const a11yRules = Object.keys(rules).filter((rule) => rule.startsWith("jsx-a11y/"));
      expect(a11yRules).toHaveLength(0);
    });

    it("counts correct number of rules per preset", () => {
      const minimalConfig = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "minimal",
      });
      const recommendedConfig = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "recommended",
      });
      const strictConfig = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "strict",
      });

      const countA11yRules = (config: OxlintConfig) =>
        Object.keys(config.rules).filter((rule) => rule.startsWith("jsx-a11y/")).length;

      expect(countA11yRules(minimalConfig)).toBe(15);
      expect(countA11yRules(recommendedConfig)).toBe(31);
      expect(countA11yRules(strictConfig)).toBe(33);
    });
  });

  describe("framework configuration", () => {
    it("includes nextjs rules when framework is nextjs", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "minimal",
        framework: "nextjs",
      });
      const rules = getRules(config);
      expect(rules["react-doctor/nextjs-no-img-element"]).toBe("warn");
      expect(rules["react-doctor/nextjs-async-client-component"]).toBe("error");
    });

    it("excludes nextjs rules when framework is not nextjs", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "minimal",
        framework: "unknown",
      });
      const rules = getRules(config);
      expect(rules["react-doctor/nextjs-no-img-element"]).toBeUndefined();
      expect(rules["react-doctor/nextjs-async-client-component"]).toBeUndefined();
    });
  });

  describe("react compiler configuration", () => {
    it("includes react-perf plugin when react compiler is disabled", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "minimal",
        hasReactCompiler: false,
      });
      expect(config.plugins).toContain("react-perf");
    });

    it("excludes react-perf plugin when react compiler is enabled", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "minimal",
        hasReactCompiler: true,
      });
      expect(config.plugins).not.toContain("react-perf");
    });

    it("includes react compiler rules when react compiler is enabled", () => {
      const config = createOxlintConfig({
        ...baseOptions,
        accessibilityPreset: "minimal",
        hasReactCompiler: true,
      });
      const rules = getRules(config);
      expect(rules["react-hooks-js/immutability"]).toBe("error");
      expect(rules["react-hooks-js/purity"]).toBe("error");
    });
  });
});
