import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { runScanRule } from "../../test-utils/run-scan-rule.js";
import { ruleRegistry } from "../rule-registry.js";
import { KNOWN_UNCOVERED } from "./known-uncovered.js";
import { livenessFixtures } from "./liveness-fixtures.js";
import type { LivenessFixture } from "./liveness-fixtures.js";
import type { Rule } from "../utils/rule.js";

const countFindings = (rule: Rule, fixture: LivenessFixture): number => {
  if (typeof rule.scan === "function") {
    return runScanRule(rule, {
      relativePath: fixture.filePath ?? "src/fixture.tsx",
      content: fixture.code,
      isGeneratedBundle: fixture.isGeneratedBundle,
    }).length;
  }
  const result = runRule(rule, fixture.code, {
    ...(fixture.filePath !== undefined ? { filename: fixture.filePath } : {}),
    ...(fixture.settings !== undefined ? { settings: fixture.settings } : {}),
    ...(fixture.forceJsx !== undefined ? { forceJsx: fixture.forceJsx } : {}),
  });
  return result.diagnostics.length;
};

describe("rule liveness", () => {
  const registeredRuleIds = new Set(Object.keys(ruleRegistry));

  it("has no fixture for an unregistered rule id", () => {
    const staleFixtureIds = Object.keys(livenessFixtures).filter(
      (ruleId) => !registeredRuleIds.has(ruleId),
    );
    expect(staleFixtureIds).toEqual([]);
  });

  it("has no KNOWN_UNCOVERED entry for an unregistered rule id", () => {
    const staleUncoveredIds = Object.keys(KNOWN_UNCOVERED).filter(
      (ruleId) => !registeredRuleIds.has(ruleId),
    );
    expect(staleUncoveredIds).toEqual([]);
  });

  it("has no KNOWN_UNCOVERED entry for a rule that already has a fixture", () => {
    const redundantUncoveredIds = Object.keys(KNOWN_UNCOVERED).filter(
      (ruleId) => ruleId in livenessFixtures,
    );
    expect(redundantUncoveredIds).toEqual([]);
  });

  for (const [ruleId, rule] of Object.entries(ruleRegistry)) {
    const fixture = livenessFixtures[ruleId];

    if (!fixture) {
      it(`${ruleId} without a fixture is explicitly allowlisted in KNOWN_UNCOVERED`, () => {
        expect(
          KNOWN_UNCOVERED[ruleId],
          `Rule "${ruleId}" has no positive-control fixture. Add one to ` +
            `liveness-fixtures.ts (a minimal snippet the rule MUST fire on), or — only if the ` +
            `rule genuinely cannot run in the in-memory harness — add it to KNOWN_UNCOVERED ` +
            `with a reason.`,
        ).toBeDefined();
      });
      continue;
    }

    it(`${ruleId} fires on its canonical bad example`, () => {
      expect(
        countFindings(rule, fixture),
        `Rule "${ruleId}" reported nothing on its liveness fixture — the rule is dead ` +
          `or the fixture no longer matches its detection logic.`,
      ).toBeGreaterThanOrEqual(1);
    });
  }
});
