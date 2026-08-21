import { describe, expect, it } from "vite-plus/test";
import {
  ALL_REACT_DOCTOR_RULES,
  REACT_DOCTOR_OPT_IN_PROJECT_RULE_IDS,
  REACT_DOCTOR_PROJECT_RULES,
  RECOMMENDED_RULES,
} from "../rules.js";
import { ruleRegistry } from "./rule-registry.js";

const PROJECT_RULE_IDS: ReadonlyArray<string> = [
  "circular-dependency",
  "duplicate-jsx-subtree",
  "unused-dependency",
  "unused-dev-dependency",
  "unused-export",
  "unused-file",
  "unused-type",
];

const OPT_IN_PROJECT_RULE_IDS = PROJECT_RULE_IDS.filter(
  (ruleId) => ruleId !== "duplicate-jsx-subtree",
);

describe("project rule registry", () => {
  it("registers the seven core-owned project rules", () => {
    expect(REACT_DOCTOR_PROJECT_RULES.map((entry) => entry.id)).toEqual(PROJECT_RULE_IDS);
    for (const ruleId of PROJECT_RULE_IDS) {
      expect(ruleRegistry[ruleId]?.execution).toBe("project");
      expect(ruleRegistry[ruleId]?.category).toBe("Maintainability");
      expect(ruleRegistry[ruleId]?.severity).toBe("warn");
      expect(ruleRegistry[ruleId]?.tags).toContain("project-analysis");
    }
  });

  it("keeps duplicate JSX on and graph hygiene rules opt-in", () => {
    expect(ruleRegistry["duplicate-jsx-subtree"]?.defaultEnabled).not.toBe(false);
    for (const ruleId of OPT_IN_PROJECT_RULE_IDS) {
      expect(ruleRegistry[ruleId]?.defaultEnabled, ruleId).toBe(false);
    }
    expect(REACT_DOCTOR_OPT_IN_PROJECT_RULE_IDS).toEqual(new Set(OPT_IN_PROJECT_RULE_IDS));
  });

  it("excludes project rules from oxlint and ESLint rule maps", () => {
    for (const ruleId of PROJECT_RULE_IDS) {
      const ruleKey = `react-doctor/${ruleId}`;
      expect(RECOMMENDED_RULES).not.toHaveProperty(ruleKey);
      expect(ALL_REACT_DOCTOR_RULES).not.toHaveProperty(ruleKey);
    }
  });
});
