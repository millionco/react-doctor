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
    "vercel-skill parity rules",
    {
      "no-dynamic-import-path": {
        fixture: "new-rules.tsx",
        ruleSource: "rules/bundle-size.ts",
        category: "Bundle Size",
      },
      "rendering-hoist-jsx": {
        fixture: "new-rules.tsx",
        ruleSource: "rules/performance.ts",
        category: "Performance",
      },
      "rerender-memo-before-early-return": {
        fixture: "composition-issues.tsx",
        ruleSource: "rules/performance.ts",
        category: "Performance",
      },
      "js-cache-property-access": {
        fixture: "new-rules.tsx",
        ruleSource: "rules/js-performance.ts",
        category: "Performance",
      },
      "js-length-check-first": {
        fixture: "new-rules.tsx",
        ruleSource: "rules/js-performance.ts",
        category: "Performance",
      },
      "js-hoist-intl": {
        fixture: "new-rules.tsx",
        ruleSource: "rules/js-performance.ts",
        category: "Performance",
      },
      "no-effect-event-in-deps": {
        fixture: "new-rules.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "error",
      },
      "no-prop-callback-in-effect": {
        fixture: "composition-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
      },
      "no-polymorphic-children": {
        fixture: "composition-issues.tsx",
        ruleSource: "rules/correctness.ts",
        category: "Architecture",
      },
      "rendering-svg-precision": {
        fixture: "composition-issues.tsx",
        ruleSource: "rules/correctness.ts",
        category: "Performance",
      },
      "no-document-start-view-transition": {
        fixture: "view-transitions-issues.tsx",
        ruleSource: "rules/view-transitions.ts",
        category: "Correctness",
      },
      "no-flush-sync": {
        fixture: "view-transitions-issues.tsx",
        ruleSource: "rules/view-transitions.ts",
        category: "Performance",
      },
      "rendering-hydration-mismatch-time": {
        fixture: "hydration-and-scroll-issues.tsx",
        ruleSource: "rules/performance.ts",
        category: "Correctness",
      },
      "rerender-transitions-scroll": {
        fixture: "hydration-and-scroll-issues.tsx",
        ruleSource: "rules/performance.ts",
        category: "Performance",
      },
      "async-defer-await": {
        fixture: "transient-and-async-issues.tsx",
        ruleSource: "rules/performance.ts",
        category: "Performance",
      },
      "rerender-state-only-in-handlers": {
        fixture: "transient-and-async-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        category: "Performance",
      },
      "client-localstorage-no-version": {
        fixture: "transient-and-async-issues.tsx",
        ruleSource: "rules/client.ts",
        category: "Correctness",
      },
      "react-compiler-destructure-method": {
        fixture: "transient-and-async-issues.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "async-await-in-loop": {
        fixture: "async-and-handler-issues.tsx",
        ruleSource: "rules/js-performance.ts",
        category: "Performance",
      },
      "advanced-event-handler-refs": {
        fixture: "async-and-handler-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        category: "Performance",
      },
      "rerender-defer-reads-hook": {
        fixture: "async-and-handler-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        category: "Performance",
      },
      "rerender-derived-state-from-hook": {
        fixture: "async-and-handler-issues.tsx",
        ruleSource: "rules/performance.ts",
        category: "Performance",
      },
    },
    () => basicReactDiagnostics,
  );
});
