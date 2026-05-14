import { beforeAll, describe, expect, it } from "vite-plus/test";
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

  describe("tanstack-query false-positive freedom", () => {
    it("does not flag useMutation that calls setQueryData (or any other cache-update method)", () => {
      const mutationLines = basicReactDiagnostics
        .filter(
          (diagnostic) =>
            diagnostic.rule === "query-mutation-missing-invalidation" &&
            diagnostic.filePath.includes("query-issues"),
        )
        .map((diagnostic) => diagnostic.line);
      // The fixture has two useMutation calls: line ~51 with NO cache
      // update (must fire), and the setQueryData example a few lines
      // below (must NOT fire).
      expect(mutationLines).toEqual([51]);
    });
  });

  describeRules(
    "tanstack-query rules",
    {
      "query-stable-query-client": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        severity: "warning",
        category: "TanStack Query",
      },
      "query-no-rest-destructuring": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "TanStack Query",
      },
      "query-no-void-query-fn": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "TanStack Query",
      },
      "query-no-query-in-effect": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "TanStack Query",
      },
      "query-mutation-missing-invalidation": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "TanStack Query",
      },
      "query-no-usequery-for-mutation": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "TanStack Query",
      },
    },
    () => basicReactDiagnostics,
  );
});
