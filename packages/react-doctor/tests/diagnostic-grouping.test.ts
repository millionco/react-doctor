import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { getSharedFixSiteCount } from "../src/cli/utils/diagnostic-grouping.js";

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
