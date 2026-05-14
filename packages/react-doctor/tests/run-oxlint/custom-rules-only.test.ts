import { describe, expect, it } from "vite-plus/test";
import { runOxlint } from "../../src/core/runners/run-oxlint.js";
import { buildTestProject } from "../regressions/_helpers.js";
import { BASIC_REACT_DIRECTORY } from "./_helpers.js";

describe("runOxlint", () => {
  describe("customRulesOnly mode", () => {
    const buildCustomOnlyOptions = () => ({
      rootDirectory: BASIC_REACT_DIRECTORY,
      project: buildTestProject({
        rootDirectory: BASIC_REACT_DIRECTORY,
        hasTanStackQuery: true,
      }),
      customRulesOnly: true,
    });

    it("excludes builtin react/ and jsx-a11y/ rules when customRulesOnly is true", async () => {
      const customOnlyDiagnostics = await runOxlint(buildCustomOnlyOptions());

      const builtinPluginDiagnostics = customOnlyDiagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react" || diagnostic.plugin === "jsx-a11y",
      );
      expect(builtinPluginDiagnostics).toHaveLength(0);
    });

    it("still includes react-doctor/* rules when customRulesOnly is true", async () => {
      const customOnlyDiagnostics = await runOxlint(buildCustomOnlyOptions());

      const reactDoctorDiagnostics = customOnlyDiagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor",
      );
      expect(reactDoctorDiagnostics.length).toBeGreaterThan(0);
    });
  });
});
