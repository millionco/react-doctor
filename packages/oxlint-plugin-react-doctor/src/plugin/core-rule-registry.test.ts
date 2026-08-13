import { describe, expect, it } from "vite-plus/test";
import { CORE_REACT_DOCTOR_RULES } from "./core-rule-registry.js";
import { reactDoctorRules } from "./rule-registry.js";
import { reactDoctorScanRules } from "./security-scan-rule-registry.js";
import type { Capability } from "./utils/capability.js";

describe("core rule registry", () => {
  it("matches the full plugin registry metadata", () => {
    const coreEntryById = new Map(CORE_REACT_DOCTOR_RULES.map((entry) => [entry.id, entry]));

    expect(CORE_REACT_DOCTOR_RULES).toHaveLength(reactDoctorRules.length);
    for (const fullEntry of reactDoctorRules) {
      const coreEntry = coreEntryById.get(fullEntry.id);
      expect(coreEntry).toBeDefined();
      expect(coreEntry?.key).toBe(fullEntry.key);
      expect(coreEntry?.source).toBe(fullEntry.source);
      expect(coreEntry?.originallyExternal).toBe(fullEntry.originallyExternal);
      expect(coreEntry?.rule.id).toBe(fullEntry.rule.id);
      expect(coreEntry?.rule.title).toBe(fullEntry.rule.title);
      expect(coreEntry?.rule.severity).toBe(fullEntry.rule.severity);
      expect(coreEntry?.rule.recommendation).toBe(fullEntry.rule.recommendation);
      expect(coreEntry?.rule.category).toBe(fullEntry.rule.category);
      expect(coreEntry?.rule.framework).toBe(fullEntry.rule.framework);
      expect(coreEntry?.rule.requires).toEqual(fullEntry.rule.requires);
      expect(coreEntry?.rule.disabledWhen).toEqual(fullEntry.rule.disabledWhen);
      expect(coreEntry?.rule.tags).toEqual(fullEntry.rule.tags);
      expect(coreEntry?.rule.defaultEnabled).toBe(fullEntry.rule.defaultEnabled);
      expect(coreEntry?.rule.matchByOccurrence).toBe(fullEntry.rule.matchByOccurrence);
      expect(coreEntry?.rule.isScanRule).toBe(typeof fullEntry.rule.scan === "function");
      expect(coreEntry?.rule.isProjectRule).toBe(
        fullEntry.rule.execution === "project" ? true : undefined,
      );
      expect(Boolean(coreEntry?.rule.recommendationFor)).toBe(
        Boolean(fullEntry.rule.recommendationFor),
      );
    }
  });

  it("matches capability-conditioned recommendations", () => {
    const capabilitySamples = [
      "nextjs",
      "nextjs:static-export",
      "vite",
      "tanstack-start",
      "cra",
      "gatsby",
      "react",
    ] as const;
    const fullEntryById = new Map<string, (typeof reactDoctorRules)[number]>(
      reactDoctorRules.map((entry) => [entry.id, entry]),
    );

    for (const coreEntry of CORE_REACT_DOCTOR_RULES) {
      if (!coreEntry.rule.recommendationFor) continue;
      const fullRecommendationFor = fullEntryById.get(coreEntry.id)?.rule.recommendationFor;
      expect(fullRecommendationFor).toBeDefined();
      for (const activeCapability of capabilitySamples) {
        const hasCapability = (capability: Capability): boolean => capability === activeCapability;
        expect(coreEntry.rule.recommendationFor(hasCapability)).toBe(
          fullRecommendationFor?.(hasCapability),
        );
      }
    }
  });

  it("contains exactly the full registry's scan rules", () => {
    expect(reactDoctorScanRules.map((entry) => entry.id)).toEqual(
      reactDoctorRules
        .filter((entry) => typeof entry.rule.scan === "function")
        .map((entry) => entry.id),
    );
  });

  it("contains exactly the full registry's project rules", () => {
    expect(
      CORE_REACT_DOCTOR_RULES.filter((entry) => entry.rule.isProjectRule).map((entry) => entry.id),
    ).toEqual(
      reactDoctorRules
        .filter((entry) => entry.rule.execution === "project")
        .map((entry) => entry.id),
    );
  });
});
