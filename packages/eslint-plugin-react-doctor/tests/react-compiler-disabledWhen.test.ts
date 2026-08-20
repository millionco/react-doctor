import { describe, expect, it } from "vite-plus/test";
import oxlintPlugin from "oxlint-plugin-react-doctor";
import eslintPlugin from "../src/index.js";

describe("ESLint plugin respects disabledWhen for react-compiler", () => {
  const REACT_COMPILER_DISABLED_RULES = [
    "jsx-no-new-function-as-prop",
    "jsx-no-new-object-as-prop",
    "jsx-no-new-array-as-prop",
    "jsx-no-jsx-as-prop",
    "jsx-no-constructed-context-values",
    "context-provider-value-from-unmemoized-local-literal",
    "no-inline-prop-on-memo-component",
    "prefer-module-scope-static-value",
    "prefer-module-scope-pure-function",
    "prefer-stable-empty-fallback",
    "rendering-hoist-jsx",
    "rerender-memo-with-default-value",
    "rerender-dependencies",
    "no-effect-with-fresh-deps",
    "rn-no-inline-object-in-list-item",
    "rn-no-inline-flatlist-renderitem",
    "rn-list-data-mapped",
    "rn-list-callback-per-row",
  ];

  it("verifies test rules have disabledWhen: ['react-compiler'] in oxlint plugin", () => {
    for (const ruleName of REACT_COMPILER_DISABLED_RULES) {
      const rule = oxlintPlugin.rules[ruleName];
      expect(rule).toBeDefined();
      expect(rule?.disabledWhen).toContain("react-compiler");
    }
  });

  it("disables all react-compiler-gated rules when capability is present", () => {
    const mockContext = {
      report: () => {},
      filename: "test.tsx",
      settings: { "react-doctor": { capabilities: ["react-compiler"] } },
    };

    for (const ruleName of REACT_COMPILER_DISABLED_RULES) {
      const eslintRule = eslintPlugin.rules[ruleName];
      expect(eslintRule).toBeDefined();
      if (!eslintRule) continue;

      const visitors = eslintRule.create(mockContext);
      expect(Object.keys(visitors)).toHaveLength(0);
    }
  });

  it("enables all react-compiler-gated rules when capability is absent", () => {
    const mockContext = {
      report: () => {},
      filename: "test.tsx",
      settings: { "react-doctor": { capabilities: [] } },
    };

    for (const ruleName of REACT_COMPILER_DISABLED_RULES) {
      const eslintRule = eslintPlugin.rules[ruleName];
      expect(eslintRule).toBeDefined();
      if (!eslintRule) continue;

      const visitors = eslintRule.create(mockContext);
      expect(Object.keys(visitors).length).toBeGreaterThan(0);
    }
  });

  it("enables rules when settings object is missing entirely", () => {
    const mockContext = {
      report: () => {},
      filename: "test.tsx",
    };

    for (const ruleName of REACT_COMPILER_DISABLED_RULES) {
      const eslintRule = eslintPlugin.rules[ruleName];
      expect(eslintRule).toBeDefined();
      if (!eslintRule) continue;

      const visitors = eslintRule.create(mockContext);
      expect(Object.keys(visitors).length).toBeGreaterThan(0);
    }
  });

  it("requires: ['react-compiler'] rule stays active when capability is present", () => {
    const ruleName = "react-compiler-no-manual-memoization";
    const oxlintRule = oxlintPlugin.rules[ruleName];
    const eslintRule = eslintPlugin.rules[ruleName];

    expect(oxlintRule).toBeDefined();
    expect(eslintRule).toBeDefined();
    if (!oxlintRule || !eslintRule) return;

    expect(oxlintRule.requires).toContain("react-compiler");
    expect(oxlintRule.disabledWhen).toBeUndefined();

    const mockContext = {
      report: () => {},
      filename: "test.tsx",
      settings: { "react-doctor": { capabilities: ["react-compiler"] } },
    };

    const visitors = eslintRule.create(mockContext);
    expect(Object.keys(visitors).length).toBeGreaterThan(0);
  });
});
