import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SURFACE_EXCLUDED_TAGS,
  DIAGNOSTIC_SURFACES,
  filterDiagnosticsForSurface,
  isDiagnosticOnSurface,
  isDiagnosticSurface,
} from "@react-doctor/core";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/core";

const designDiagnostic: Diagnostic = {
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "design-no-redundant-size-axes",
  severity: "warning",
  message: "w-5 h-5 → use the shorthand size-5 (Tailwind v3.4+)",
  help: "",
  line: 12,
  column: 4,
  category: "Architecture",
};

const correctnessDiagnostic: Diagnostic = {
  filePath: "src/Form.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-as-key",
  severity: "error",
  message: "Array index used as React key",
  help: "",
  line: 18,
  column: 5,
  category: "Correctness",
};

const externalPluginDiagnostic: Diagnostic = {
  filePath: "src/Other.tsx",
  plugin: "react",
  rule: "no-danger",
  severity: "warning",
  message: "Avoid dangerouslySetInnerHTML",
  help: "",
  line: 5,
  column: 2,
  category: "Security",
};

describe("filterDiagnosticsForSurface defaults", () => {
  it("strips `design`-tagged rules from PR comment, score, and CI failure surfaces by default", () => {
    const diagnostics = [designDiagnostic, correctnessDiagnostic];

    expect(filterDiagnosticsForSurface(diagnostics, "prComment", null)).toEqual([
      correctnessDiagnostic,
    ]);
    expect(filterDiagnosticsForSurface(diagnostics, "score", null)).toEqual([
      correctnessDiagnostic,
    ]);
    expect(filterDiagnosticsForSurface(diagnostics, "ciFailure", null)).toEqual([
      correctnessDiagnostic,
    ]);
  });

  it("keeps `design`-tagged rules visible on the CLI surface (so devs still see suggestions locally)", () => {
    const diagnostics = [designDiagnostic, correctnessDiagnostic];
    expect(filterDiagnosticsForSurface(diagnostics, "cli", null)).toEqual(diagnostics);
  });

  it("does not filter diagnostics from external plugins (no react-doctor tag metadata to consult)", () => {
    const diagnostics = [externalPluginDiagnostic];
    for (const surface of DIAGNOSTIC_SURFACES) {
      expect(filterDiagnosticsForSurface(diagnostics, surface, null)).toEqual(diagnostics);
    }
  });
});

describe("filterDiagnosticsForSurface — user overrides", () => {
  it("`includeTags` promotes excluded rules back into the surface", () => {
    const config: ReactDoctorConfig = {
      surfaces: { prComment: { includeTags: ["design"] } },
    };
    const diagnostics = [designDiagnostic, correctnessDiagnostic];
    expect(filterDiagnosticsForSurface(diagnostics, "prComment", config)).toEqual(diagnostics);
  });

  it("`excludeTags` removes additional rule families from a surface", () => {
    const config: ReactDoctorConfig = {
      surfaces: { score: { excludeTags: ["test-noise"] } },
    };
    const diagnostics = [designDiagnostic, correctnessDiagnostic];
    expect(filterDiagnosticsForSurface(diagnostics, "score", config)).toEqual([
      correctnessDiagnostic,
    ]);
  });

  it("`excludeCategories` removes everything in a category from a surface", () => {
    const config: ReactDoctorConfig = {
      surfaces: { ciFailure: { excludeCategories: ["Correctness"] } },
    };
    const diagnostics = [designDiagnostic, correctnessDiagnostic];
    expect(filterDiagnosticsForSurface(diagnostics, "ciFailure", config)).toEqual([]);
  });

  it("`excludeRules` strips a specific rule even when its tags are otherwise allowed on CLI", () => {
    const config: ReactDoctorConfig = {
      surfaces: { cli: { excludeRules: ["react-doctor/no-array-index-as-key"] } },
    };
    const diagnostics = [designDiagnostic, correctnessDiagnostic];
    expect(filterDiagnosticsForSurface(diagnostics, "cli", config)).toEqual([designDiagnostic]);
  });

  it("`includeRules` overrides excludeTags for a single rule (include wins)", () => {
    const config: ReactDoctorConfig = {
      surfaces: {
        prComment: {
          includeRules: ["react-doctor/design-no-redundant-size-axes"],
        },
      },
    };
    expect(isDiagnosticOnSurface(designDiagnostic, "prComment", config)).toBe(true);
  });
});

describe("DiagnosticSurface guards and defaults", () => {
  it("`isDiagnosticSurface` accepts only the four known surface names", () => {
    for (const surface of DIAGNOSTIC_SURFACES) {
      expect(isDiagnosticSurface(surface)).toBe(true);
    }
    expect(isDiagnosticSurface("dashboard")).toBe(false);
    expect(isDiagnosticSurface(42)).toBe(false);
    expect(isDiagnosticSurface(undefined)).toBe(false);
  });

  it("`DEFAULT_SURFACE_EXCLUDED_TAGS` keeps `design` out of every non-CLI surface", () => {
    expect(DEFAULT_SURFACE_EXCLUDED_TAGS.cli).toEqual([]);
    expect(DEFAULT_SURFACE_EXCLUDED_TAGS.prComment).toContain("design");
    expect(DEFAULT_SURFACE_EXCLUDED_TAGS.score).toContain("design");
    expect(DEFAULT_SURFACE_EXCLUDED_TAGS.ciFailure).toContain("design");
  });
});
