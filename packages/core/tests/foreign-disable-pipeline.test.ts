import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticPipeline } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

const noEvalDiagnostic: Diagnostic = {
  filePath: "src/run.ts",
  plugin: "react-doctor",
  rule: "no-eval",
  severity: "error",
  message: "eval() is a code-injection vulnerability.",
  help: "",
  line: 2,
  column: 1,
  category: "Security",
};

describe("buildDiagnosticPipeline — foreign disable near-miss hint wiring", () => {
  it("stamps a suppressionHint on a firing diagnostic whose eslint-disable used the bare name", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["// eslint-disable-next-line no-eval", "eval(code);"],
    });

    const result = pipeline.apply(noEvalDiagnostic);

    expect(result).not.toBeNull();
    expect(result?.suppressionHint).toContain("react-doctor/no-eval");
  });

  it("leaves the diagnostic untouched when the canonical name was used (oxlint already handles it)", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["// eslint-disable-next-line react-doctor/no-eval", "eval(code);"],
    });

    const result = pipeline.apply(noEvalDiagnostic);

    expect(result?.suppressionHint).toBeUndefined();
  });

  it("stamps a hint for a file-level block disable that used the bare name", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["/* eslint-disable no-eval */", "const a = 1;", "eval(code);"],
    });

    const result = pipeline.apply({ ...noEvalDiagnostic, line: 3 });

    expect(result?.suppressionHint).toContain("react-doctor/no-eval");
  });

  it("drops the diagnostic when react-doctor-disable used the bare short id", () => {
    const pipeline = buildDiagnosticPipeline({
      rootDirectory: "/repo",
      userConfig: null,
      respectInlineDisables: true,
      showWarnings: true,
      readFileLinesSync: () => ["// react-doctor-disable-next-line no-eval", "eval(code);"],
    });

    expect(pipeline.apply(noEvalDiagnostic)).toBeNull();
  });
});
