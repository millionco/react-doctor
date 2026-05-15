import { beforeAll, describe } from "vite-plus/test";
import type { Diagnostic } from "../../src/types/diagnostic.js";
import { runOxlint } from "../../src/core/run-oxlint.js";
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
    "async performance rules",
    {
      "async-parallel": {
        fixture: "js-performance-issues.tsx",
        ruleSource: "rules/js-performance.ts",
      },
      "js-flatmap-filter": {
        fixture: "js-performance-issues.tsx",
        ruleSource: "rules/js-performance.ts",
        category: "Performance",
      },
    },
    () => basicReactDiagnostics,
  );
});
