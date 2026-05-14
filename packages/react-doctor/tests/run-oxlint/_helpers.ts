import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../../src/types/diagnostic.js";

export const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "..", "fixtures");
export const BASIC_REACT_DIRECTORY = path.join(FIXTURES_DIRECTORY, "basic-react");
export const NEXTJS_APP_DIRECTORY = path.join(FIXTURES_DIRECTORY, "nextjs-app");
export const TANSTACK_START_APP_DIRECTORY = path.join(FIXTURES_DIRECTORY, "tanstack-start-app");
export const USER_OXLINT_CONFIG_DIRECTORY = path.join(FIXTURES_DIRECTORY, "user-oxlint-config");
export const USER_OXLINT_CONFIG_BROKEN_DIRECTORY = path.join(
  FIXTURES_DIRECTORY,
  "user-oxlint-config-broken",
);

export const findDiagnosticsByRule = (diagnostics: Diagnostic[], rule: string): Diagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.rule === rule);

export interface RuleTestCase {
  fixture: string;
  ruleSource: string;
  severity?: "error" | "warning";
  category?: string;
}

export const describeRules = (
  groupName: string,
  rules: Record<string, RuleTestCase>,
  getDiagnostics: () => Diagnostic[],
): void => {
  describe(groupName, () => {
    for (const [ruleName, testCase] of Object.entries(rules)) {
      it(`${ruleName} (${testCase.fixture} → ${testCase.ruleSource})`, () => {
        const issues = findDiagnosticsByRule(getDiagnostics(), ruleName);
        expect(issues.length).toBeGreaterThan(0);
        if (testCase.severity) expect(issues[0].severity).toBe(testCase.severity);
        if (testCase.category) expect(issues[0].category).toBe(testCase.category);
      });
    }
  });
};
