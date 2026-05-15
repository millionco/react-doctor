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
    "state & effects rules",
    {
      "no-derived-state-effect": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
        category: "State & Effects",
      },
      "no-fetch-in-effect": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
      },
      "no-mirror-prop-effect": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
        category: "State & Effects",
      },
      "no-mutable-in-deps": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "error",
        category: "State & Effects",
      },
      "effect-needs-cleanup": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "error",
        category: "State & Effects",
      },
      "no-cascading-set-state": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
      },
      "no-effect-chain": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
        category: "State & Effects",
      },
      "no-effect-event-handler": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
      },
      "no-derived-useState": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
      },
      "prefer-use-effect-event": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
        category: "State & Effects",
      },
      "prefer-useReducer": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
      },
      "rerender-lazy-state-init": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
      },
      "rerender-functional-setstate": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
      },
      "rerender-dependencies": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "error",
      },
      "no-direct-state-mutation": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
        category: "State & Effects",
      },
      "no-set-state-in-render": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
        category: "State & Effects",
      },
      "prefer-use-sync-external-store": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
        category: "State & Effects",
      },
      "no-event-trigger-state": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
        category: "State & Effects",
      },
    },
    () => basicReactDiagnostics,
  );
});
