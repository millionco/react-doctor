import { beforeAll, describe } from "vite-plus/test";
import type { Diagnostic } from "../../src/types/diagnostic.js";
import { runOxlint } from "../../src/core/runners/run-oxlint.js";
import { buildTestProject } from "../regressions/_helpers.js";
import { BASIC_REACT_DIRECTORY, describeRules } from "./_helpers.js";

let basicReactDiagnostics: Diagnostic[];

describe("runOxlint", () => {
  beforeAll(async () => {
    basicReactDiagnostics = await runOxlint({
      rootDirectory: BASIC_REACT_DIRECTORY,
      project: buildTestProject({
        rootDirectory: BASIC_REACT_DIRECTORY,
        hasTanStackQuery: true,
      }),
    });
  });

  describeRules(
    "correctness rules",
    {
      "no-array-index-as-key": {
        fixture: "correctness-issues.tsx",
        ruleSource: "rules/correctness.ts",
        category: "Correctness",
      },
      "rendering-conditional-render": {
        fixture: "correctness-issues.tsx",
        ruleSource: "rules/correctness.ts",
      },
      "no-prevent-default": {
        fixture: "correctness-issues.tsx",
        ruleSource: "rules/correctness.ts",
      },
      "no-uncontrolled-input": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/correctness.ts",
        severity: "warning",
        category: "Correctness",
      },
    },
    () => basicReactDiagnostics,
  );
});
