import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject } from "../regressions/_helpers.js";
import { describeRules, TANSTACK_START_APP_DIRECTORY } from "./_helpers.js";

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
        category: "Bugs",
      },
      "tanstack-start-no-direct-fetch-in-loader": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Bugs",
      },
      "tanstack-start-no-useeffect-fetch": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Bugs",
      },
      "tanstack-start-no-anchor-element": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Bugs",
      },
      "tanstack-start-no-navigate-in-render": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Bugs",
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
        category: "Bugs",
      },
      "tanstack-start-loader-parallel-fetch": {
        fixture: "src/routes/route-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Performance",
      },
      "tanstack-start-missing-head-content": {
        fixture: "src/routes/__root.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Bugs",
      },
      "tanstack-start-server-fn-method-order": {
        fixture: "src/routes/server-fn-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        severity: "error",
        category: "Bugs",
      },
      "tanstack-start-server-fn-validate-input": {
        fixture: "src/routes/server-fn-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        category: "Bugs",
      },
      "tanstack-start-no-use-server-in-handler": {
        fixture: "src/routes/server-fn-issues.tsx",
        ruleSource: "rules/tanstack-start.ts",
        severity: "error",
        category: "Bugs",
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
        category: "Bugs",
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

    it("does not flag navigate() inside useCallback / useMemo / useEffect / JSX onXxx / onXxx option / handler-named callbacks", () => {
      const safeNavigateLines = tanstackStartDiagnostics
        .filter((diagnostic) => diagnostic.rule === "tanstack-start-no-navigate-in-render")
        .filter((diagnostic) => diagnostic.filePath.includes("route-issues"))
        .map((diagnostic) => diagnostic.line)
        .sort((a, b) => a - b);
      // Render-time navigate() calls in the fixture: line 60 inside
      // NavigateInRenderComponent (direct in component body) and line 129,
      // the forEach callback inside SyncIterationNavigateComponent
      // (synchronous iteration during render). Every other navigate() in
      // the file is wrapped in useCallback/useMemo/JSX onXxx, an `onXxx`
      // options-object callback (useForm onSubmit, #759), or a
      // handler-named local function (handleCancel/onLogout/handleRetry)
      // and must NOT fire.
      expect(safeNavigateLines).toEqual([60, 135]);
    });
  });
});
