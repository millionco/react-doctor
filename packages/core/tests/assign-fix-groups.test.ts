import { describe, expect, it } from "vite-plus/test";
import { assignFixGroups } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/Profile.tsx",
  plugin: "react-doctor",
  rule: "no-derived-state-effect",
  severity: "warning",
  message: "Your users briefly see stale state on every prop change.",
  help: "",
  line: 10,
  column: 5,
  category: "State & Effects",
  ...overrides,
});

describe("assignFixGroups", () => {
  it("returns an empty array for an empty input", () => {
    expect(assignFixGroups([])).toEqual([]);
  });

  it("leaves a lone groupable finding without a fixGroupId", () => {
    const single = buildDiagnostic();
    expect(assignFixGroups([single])).toEqual([single]);
  });

  it("stamps one shared fixGroupId on same-(file, rule, message) keyed-state sites", () => {
    const sites = [
      buildDiagnostic({ line: 12 }),
      buildDiagnostic({ line: 18 }),
      buildDiagnostic({ line: 24 }),
      buildDiagnostic({ line: 30 }),
    ];
    const result = assignFixGroups(sites);
    const ids = result.map((diagnostic) => diagnostic.fixGroupId);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids).size).toBe(1);
  });

  it("keeps distinct-message findings (interpolated state names) in separate groups", () => {
    // `no-derived-state` interpolates the state name, so two findings for
    // different state vars are genuinely different fixes — they must not merge.
    const nameField = buildDiagnostic({
      rule: "no-derived-state",
      message: 'Storing "fullName" in state when you can derive it costs an extra render.',
      line: 12,
    });
    const ageField = buildDiagnostic({
      rule: "no-derived-state",
      message: 'Storing "ageLabel" in state when you can derive it costs an extra render.',
      line: 20,
    });
    const result = assignFixGroups([nameField, ageField]);
    expect(result[0].fixGroupId).toBeUndefined();
    expect(result[1].fixGroupId).toBeUndefined();
  });

  it("does not collapse identical-message repeats for non-groupable rules", () => {
    // jsx-key emits a constant message for three different `.map()`s — same
    // message, three separate fixes — so it must stay ungrouped.
    const maps = [
      buildDiagnostic({ rule: "jsx-key", message: "Missing key on list item.", line: 5 }),
      buildDiagnostic({ rule: "jsx-key", message: "Missing key on list item.", line: 9 }),
      buildDiagnostic({ rule: "jsx-key", message: "Missing key on list item.", line: 14 }),
    ];
    const result = assignFixGroups(maps);
    expect(result.every((diagnostic) => diagnostic.fixGroupId === undefined)).toBe(true);
  });

  it("separates same-rule same-message findings across different files", () => {
    const fileA = buildDiagnostic({ filePath: "src/Profile.tsx", line: 12 });
    const fileB = buildDiagnostic({ filePath: "src/Settings.tsx", line: 12 });
    const result = assignFixGroups([fileA, fileB]);
    // Two files, one site each → neither reaches the ≥2 threshold within its
    // own group, so both stay ungrouped.
    expect(result[0].fixGroupId).toBeUndefined();
    expect(result[1].fixGroupId).toBeUndefined();
  });

  it("is deterministic — the same input yields the same fixGroupId", () => {
    const sites = [buildDiagnostic({ line: 12 }), buildDiagnostic({ line: 18 })];
    const first = assignFixGroups(sites)[0].fixGroupId;
    const second = assignFixGroups(sites)[0].fixGroupId;
    expect(first).toBe(second);
  });
});
