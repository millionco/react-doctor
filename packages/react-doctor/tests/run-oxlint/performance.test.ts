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
    "performance rules",
    {
      "no-inline-prop-on-memo-component": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
      },
      "no-usememo-simple-expression": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
        category: "Performance",
      },
      "no-layout-property-animation": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
        severity: "error",
      },
      "no-transition-all": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
      },
      "no-large-animated-blur": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
      },
      "no-scale-from-zero": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
      },
      "no-permanent-will-change": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
      },
      "rerender-memo-with-default-value": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
      },
      "rendering-animate-svg-wrapper": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
      },
      "rendering-hydration-no-flicker": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
      },
      "no-global-css-variable-animation": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
        severity: "error",
      },
      "client-passive-event-listeners": {
        fixture: "client-issues.tsx",
        ruleSource: "rules/client.ts",
      },
      "rendering-script-defer-async": {
        fixture: "performance-issues.tsx",
        ruleSource: "rules/performance.ts",
        category: "Performance",
      },
    },
    () => basicReactDiagnostics,
  );
});
