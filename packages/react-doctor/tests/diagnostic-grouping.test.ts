import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { sortDiagnosticsStable } from "@react-doctor/core";
import {
  buildSortedRuleGroups,
  getSharedFixSiteCount,
} from "../src/cli/utils/diagnostic-grouping.js";

const makeDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/Profile.tsx",
  plugin: "react-doctor",
  rule: "no-derived-state-effect",
  severity: "warning",
  message: "Your users briefly see stale state on every prop change.",
  help: "",
  line: 1,
  column: 1,
  category: "State & Effects",
  ...overrides,
});

describe("getSharedFixSiteCount", () => {
  it("returns 0 for a lone finding", () => {
    expect(getSharedFixSiteCount([makeDiagnostic({ fixGroupId: "abc" })])).toBe(0);
  });

  it("returns 0 when findings carry no fixGroupId", () => {
    const sites = [makeDiagnostic({ line: 1 }), makeDiagnostic({ line: 2 })];
    expect(getSharedFixSiteCount(sites)).toBe(0);
  });

  it("returns the site count when every finding shares one fixGroupId", () => {
    const sites = [12, 18, 24, 30].map((line) => makeDiagnostic({ line, fixGroupId: "abc" }));
    expect(getSharedFixSiteCount(sites)).toBe(4);
  });

  it("returns 0 when the group spans more than one fixGroupId", () => {
    const sites = [
      makeDiagnostic({ line: 12, fixGroupId: "abc" }),
      makeDiagnostic({ line: 18, fixGroupId: "def" }),
    ];
    expect(getSharedFixSiteCount(sites)).toBe(0);
  });
});

describe("buildSortedRuleGroups — deterministic under --no-score", () => {
  it("yields the same rule-group order for any arrival order once canonically sorted", () => {
    // No rule-priority map (the --no-score / offline / unranked case): group
    // order falls back to scan order. The canonical sort upstream replaces the
    // volatile arrival order, so the rendered groups are stable run-to-run.
    const diagnostics = [
      makeDiagnostic({ filePath: "src/Profile.tsx", rule: "no-derived-state-effect", line: 3 }),
      makeDiagnostic({ filePath: "src/Cart.tsx", rule: "no-array-index-key", line: 9 }),
      makeDiagnostic({ filePath: "src/Profile.tsx", rule: "no-array-index-key", line: 14 }),
      makeDiagnostic({ filePath: "src/Cart.tsx", rule: "rules-of-hooks", line: 1 }),
    ];
    const permutationA = [diagnostics[0], diagnostics[1], diagnostics[2], diagnostics[3]];
    const permutationB = [diagnostics[3], diagnostics[2], diagnostics[1], diagnostics[0]];

    const groupOrderA = buildSortedRuleGroups(sortDiagnosticsStable(permutationA)).map(
      ([ruleKey]) => ruleKey,
    );
    const groupOrderB = buildSortedRuleGroups(sortDiagnosticsStable(permutationB)).map(
      ([ruleKey]) => ruleKey,
    );

    expect(groupOrderA).toEqual(groupOrderB);
  });
});
