import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/core";
import { applySeverityControls } from "@react-doctor/core";

const designDiagnostic: Diagnostic = {
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "design-no-redundant-size-axes",
  severity: "warning",
  message: "w-5 h-5 → size-5",
  help: "",
  line: 12,
  column: 4,
  category: "Architecture",
};

const rnDiagnostic: Diagnostic = {
  filePath: "src/Screen.tsx",
  plugin: "react-doctor",
  rule: "rn-no-raw-text",
  severity: "error",
  message: "raw text outside <Text>",
  help: "",
  line: 4,
  column: 2,
  category: "React Native",
};

const externalPluginDiagnostic: Diagnostic = {
  filePath: "src/Form.tsx",
  plugin: "react",
  rule: "no-danger",
  severity: "warning",
  message: "Avoid dangerouslySetInnerHTML",
  help: "",
  line: 5,
  column: 2,
  category: "Security",
};

const nativePortedDiagnostic: Diagnostic = {
  ...externalPluginDiagnostic,
  plugin: "react-doctor",
  rule: "no-danger",
};

describe("applySeverityControls", () => {
  it("returns input unchanged when no top-level severity fields are configured", () => {
    const diagnostics = [designDiagnostic, rnDiagnostic];
    expect(applySeverityControls(diagnostics, null)).toBe(diagnostics);
    expect(applySeverityControls(diagnostics, {})).toBe(diagnostics);
  });

  it('drops diagnostics whose category is set to "off" via top-level `categories`', () => {
    const config: ReactDoctorConfig = { categories: { "React Native": "off" } };
    const filtered = applySeverityControls([designDiagnostic, rnDiagnostic], config);
    expect(filtered).toEqual([designDiagnostic]);
  });

  it('drops diagnostics whose rule is set to "off" via top-level `rules`', () => {
    const config: ReactDoctorConfig = {
      rules: { "react-doctor/design-no-redundant-size-axes": "off" },
    };
    const filtered = applySeverityControls([designDiagnostic, rnDiagnostic], config);
    expect(filtered).toEqual([rnDiagnostic]);
  });

  it("re-stamps severity for matching rules via top-level `rules` (ESLint shape)", () => {
    const config: ReactDoctorConfig = {
      rules: { "react-doctor/rn-no-raw-text": "warn" },
    };
    const filtered = applySeverityControls([rnDiagnostic], config);
    expect(filtered).toEqual([{ ...rnDiagnostic, severity: "warning" }]);
  });

  it("works on external-plugin diagnostics via rule key", () => {
    const config: ReactDoctorConfig = {
      rules: { "react/no-danger": "off" },
    };
    expect(applySeverityControls([externalPluginDiagnostic], config)).toEqual([]);
  });

  it("matches legacy rule keys against native ported diagnostics", () => {
    const config: ReactDoctorConfig = {
      rules: { "react/no-danger": "off" },
    };
    expect(applySeverityControls([nativePortedDiagnostic], config)).toEqual([]);
  });

  it("matches native rule keys against legacy plugin diagnostics", () => {
    const config: ReactDoctorConfig = {
      rules: { "react-doctor/no-danger": "off" },
    };
    expect(applySeverityControls([externalPluginDiagnostic], config)).toEqual([]);
  });

  it("promotes warning to error via top-level `categories`", () => {
    const config: ReactDoctorConfig = {
      categories: { Security: "error" },
    };
    const filtered = applySeverityControls([externalPluginDiagnostic], config);
    expect(filtered).toEqual([{ ...externalPluginDiagnostic, severity: "error" }]);
  });

  it("per-rule wins over per-category", () => {
    const config: ReactDoctorConfig = {
      rules: { "react-doctor/rn-no-raw-text": "warn" },
      categories: { "React Native": "off" },
    };
    expect(applySeverityControls([rnDiagnostic], config)).toEqual([
      { ...rnDiagnostic, severity: "warning" },
    ]);
  });
});
