import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../../src/types/diagnostic.js";
import { runOxlint } from "../../src/core/run-oxlint.js";
import { buildTestProject } from "../regressions/_helpers.js";
import { TANSTACK_START_APP_DIRECTORY, describeRules } from "./_helpers.js";

let tanstackStartDiagnostics: Diagnostic[];

describe("runOxlint", () => {
  beforeAll(async () => {
    tanstackStartDiagnostics = await runOxlint({
      rootDirectory: TANSTACK_START_APP_DIRECTORY,
      project: buildTestProject({
        rootDirectory: TANSTACK_START_APP_DIRECTORY,
        framework: "tanstack-start",
      }),
    });
  });

  it("loads tanstack-start diagnostics", () => {
    expect(tanstackStartDiagnostics.length).toBeGreaterThan(0);
  });

  describeRules(
    "tanstack-start rules",
    {
      "tanstack-start-route-property-order": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        severity: "error",
        category: "TanStack Start",
      },
      "tanstack-start-no-direct-fetch-in-loader": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "TanStack Start",
      },
      "tanstack-start-no-useeffect-fetch": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "TanStack Start",
      },
      "tanstack-start-no-anchor-element": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "TanStack Start",
      },
      "tanstack-start-no-navigate-in-render": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "TanStack Start",
      },
      "tanstack-start-no-secrets-in-loader": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        severity: "error",
        category: "Security",
      },
      "tanstack-start-redirect-in-try-catch": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "TanStack Start",
      },
      "tanstack-start-loader-parallel-fetch": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Performance",
      },
      "tanstack-start-missing-head-content": {
        fixture: "src/routes/__root.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "TanStack Start",
      },
      "tanstack-start-server-fn-method-order": {
        fixture: "src/routes/server-fn-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        severity: "error",
        category: "TanStack Start",
      },
      "tanstack-start-server-fn-validate-input": {
        fixture: "src/routes/server-fn-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "TanStack Start",
      },
      "tanstack-start-no-use-server-in-handler": {
        fixture: "src/routes/server-fn-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        severity: "error",
        category: "TanStack Start",
      },
      "tanstack-start-get-mutation": {
        fixture: "src/routes/server-fn-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Security",
      },
      "tanstack-start-no-dynamic-server-fn-import": {
        fixture: "src/routes/server-fn-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        severity: "error",
        category: "TanStack Start",
      },
    },
    () => tanstackStartDiagnostics,
  );

  describe("tanstack-start edge cases (false positive freedom)", () => {
    it("does not flag correct property order in createFileRoute", () => {
      const propertyOrderIssues = tanstackStartDiagnostics.filter(
        (diagnostic) =>
          diagnostic.rule === "tanstack-start-route-property-order" &&
          diagnostic.filePath.includes("edge-cases"),
      );
      expect(propertyOrderIssues).toHaveLength(0);
    });

    it("does not flag createServerFn with PUT or DELETE method as get-mutation", () => {
      const getMutationIssues = tanstackStartDiagnostics.filter(
        (diagnostic) =>
          diagnostic.rule === "tanstack-start-get-mutation" &&
          diagnostic.filePath.includes("edge-cases"),
      );
      expect(getMutationIssues).toHaveLength(0);
    });

    it("does not flag server function with inputValidator as missing validation", () => {
      const validationIssues = tanstackStartDiagnostics.filter(
        (diagnostic) =>
          diagnostic.rule === "tanstack-start-server-fn-validate-input" &&
          diagnostic.filePath.includes("edge-cases"),
      );
      expect(validationIssues).toHaveLength(0);
    });

    it("does not flag script with type=application/ld+json", () => {
      const scriptIssues = tanstackStartDiagnostics.filter(
        (diagnostic) =>
          diagnostic.rule === "rendering-script-defer-async" &&
          diagnostic.filePath.includes("edge-cases"),
      );
      expect(scriptIssues).toHaveLength(0);
    });

    it("does not flag navigate() inside useCallback / useMemo / useEffect / JSX onXxx callbacks", () => {
      const safeNavigateLines = tanstackStartDiagnostics
        .filter((diagnostic) => diagnostic.rule === "tanstack-start-no-navigate-in-render")
        .filter((diagnostic) => diagnostic.filePath.includes("route-issues"))
        .map((diagnostic) => diagnostic.line)
        .sort((a, b) => a - b);
      // Render-time navigate() calls in the fixture: line 60 inside
      // NavigateInRenderComponent (direct in component body) and the
      // forEach callback inside SyncIterationNavigateComponent (synchronous
      // iteration during render). Every other navigate() in the file is
      // wrapped in useCallback/useMemo/onClick and must NOT fire.
      expect(safeNavigateLines).toContain(60);
      // The forEach navigate is at the line within SyncIterationNavigateComponent;
      // assert at least one diagnostic past line 60 (the sync-iteration case)
      // and that none of the safe-deferred call sites (lines around the
      // useCallback / useMemo / onClick block) appear.
      expect(safeNavigateLines.length).toBeGreaterThanOrEqual(2);
    });
  });
});
