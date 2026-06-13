import { describe, expect, it } from "vite-plus/test";
import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Rule } from "oxlint-plugin-react-doctor";

const getRuleTags = (ruleId: string): ReadonlyArray<string> => {
  const rule = reactDoctorPlugin.rules[ruleId];
  if (!rule) throw new Error(`Unknown rule: ${ruleId}`);
  return rule.tags ?? [];
};

const collectRuleIdsMatching = (predicate: (rule: Rule) => boolean): string[] => {
  const matched: string[] = [];
  for (const [ruleId, rule] of Object.entries(reactDoctorPlugin.rules)) {
    if (predicate(rule)) matched.push(ruleId);
  }
  return matched;
};

describe("rule tag registration", () => {
  it('tags every React Native bucket rule with "react-native"', () => {
    const reactNativeRuleIds = collectRuleIdsMatching((rule) => rule.framework === "react-native");
    expect(reactNativeRuleIds.length).toBeGreaterThan(0);
    for (const ruleId of reactNativeRuleIds) {
      expect(getRuleTags(ruleId)).toContain("react-native");
    }
  });

  it('tags every server bucket rule with "server-action"', () => {
    // Server-bucket rules now roll up under the "Bugs" display category,
    // so identify them by their `server-` id convention instead.
    const serverRuleIds = collectRuleIdsMatching((rule) => rule.id.startsWith("server-"));
    expect(serverRuleIds.length).toBeGreaterThan(0);
    for (const ruleId of serverRuleIds) {
      expect(getRuleTags(ruleId)).toContain("server-action");
    }
  });

  it('tags every security scan rule (every rule carrying a scan) with "security-scan"', () => {
    const securityScanRuleIds = collectRuleIdsMatching((rule) => rule.scan !== undefined);
    expect(securityScanRuleIds.length).toBeGreaterThan(0);
    for (const ruleId of securityScanRuleIds) {
      expect(getRuleTags(ruleId)).toContain("security-scan");
    }
  });

  it('tags the four migration-hint rules with "migration-hint"', () => {
    const migrationHintRuleIds = [
      "no-react19-deprecated-apis",
      "no-react-dom-deprecated-apis",
      "no-legacy-class-lifecycles",
      "no-legacy-context-api",
    ];
    for (const ruleId of migrationHintRuleIds) {
      expect(getRuleTags(ruleId)).toContain("migration-hint");
    }
  });

  it("preserves rule-authored tags alongside bucket auto-tags (e.g. test-noise stays on react-native rules that opted in)", () => {
    // `rn-no-raw-text` is in the react-native bucket and authors
    // "test-noise"; the bucket auto-tag is added alongside it.
    // `no-react19-deprecated-apis` is in architecture and authors both
    // "test-noise" and "migration-hint" — no auto-tag overwrites those.
    const rnNoRawTextTags = getRuleTags("rn-no-raw-text");
    expect(rnNoRawTextTags).toContain("react-native");
    expect(rnNoRawTextTags).toContain("test-noise");
    const migrationHintTags = getRuleTags("no-react19-deprecated-apis");
    expect(migrationHintTags).toContain("test-noise");
    expect(migrationHintTags).toContain("migration-hint");
  });
});
