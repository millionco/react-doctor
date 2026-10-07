import { describe, expect, it } from "vite-plus/test";
import {
  countOptInProjectRuleSelections,
  resolveProjectRuleSelections,
  shouldUseMaintainabilityLayer,
  type RuleSeverityControls,
} from "@react-doctor/core";

const selectedRuleKeys = (controls?: RuleSeverityControls): string[] =>
  resolveProjectRuleSelections(controls).map((selection) => selection.ruleKey);

describe("resolveProjectRuleSelections", () => {
  it("enables only the default project rule without controls", () => {
    expect(resolveProjectRuleSelections(undefined)).toEqual([
      {
        ruleId: "duplicate-jsx-subtree",
        ruleKey: "react-doctor/duplicate-jsx-subtree",
        severity: "warn",
        hasExplicitSeverity: false,
      },
    ]);
  });

  it("does not activate opt-in project rules through a category override", () => {
    expect(resolveProjectRuleSelections({ categories: { Maintainability: "error" } })).toEqual([
      {
        ruleId: "duplicate-jsx-subtree",
        ruleKey: "react-doctor/duplicate-jsx-subtree",
        severity: "error",
        hasExplicitSeverity: true,
      },
    ]);
  });

  it("activates an opt-in project rule through its canonical key", () => {
    expect(
      resolveProjectRuleSelections({
        rules: { "react-doctor/unused-export": "error" },
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          ruleId: "unused-export",
          ruleKey: "react-doctor/unused-export",
          severity: "error",
          hasExplicitSeverity: true,
        },
      ]),
    );
  });

  it("activates opt-in project rules through legacy deslop aliases", () => {
    expect(
      resolveProjectRuleSelections({
        rules: {
          "deslop/circular-dependency": "warn",
          "deslop/unused-file": "error",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          ruleId: "circular-dependency",
          ruleKey: "react-doctor/circular-dependency",
          severity: "warn",
          hasExplicitSeverity: true,
        },
        {
          ruleId: "unused-file",
          ruleKey: "react-doctor/unused-file",
          severity: "error",
          hasExplicitSeverity: true,
        },
      ]),
    );
  });

  it("lets a per-rule opt-in override a disabled category", () => {
    expect(
      selectedRuleKeys({
        categories: { Maintainability: "off" },
        rules: { "react-doctor/unused-dependency": "warn" },
      }),
    ).toEqual(["react-doctor/unused-dependency"]);
  });

  it("honors explicit off overrides", () => {
    expect(
      selectedRuleKeys({
        rules: {
          "react-doctor/duplicate-jsx-subtree": "off",
          "react-doctor/unused-type": "off",
        },
      }),
    ).toEqual([]);
  });

  it("counts only enabled opt-in graph rules", () => {
    expect(
      countOptInProjectRuleSelections({
        categories: { Maintainability: "error" },
        rules: {
          "deslop/unused-export": "warn",
          "react-doctor/unused-dependency": "error",
          "react-doctor/unused-type": "off",
        },
      }),
    ).toBe(2);
  });

  it("loads maintainability for duplicate JSX or an opt-in graph rule", () => {
    expect(
      shouldUseMaintainabilityLayer({
        shouldRunDuplicateJsx: false,
        userConfig: { rules: { "react-doctor/unused-export": "warn" } },
      }),
    ).toBe(true);
    expect(
      shouldUseMaintainabilityLayer({
        shouldRunDuplicateJsx: false,
        userConfig: null,
      }),
    ).toBe(false);
  });
});
