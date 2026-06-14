import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { runOxlint } from "@react-doctor/core";
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
    // #818: `query-destructure-result` keys on the `useQuery` name, but only
    // TanStack's hook returns a `{ data, ... }` result worth destructuring.
    // Convex's same-named hook returns a scalar, so the rule must defer to the
    // import source. Scoped to the two fixtures so it is independent of the
    // shared whole-project run above.
    it("flags a TanStack useQuery whole-result but not a Convex useQuery (#818)", async () => {
      const scopedDiagnostics = await runOxlint({
        rootDirectory: BASIC_REACT_DIRECTORY,
        project: buildTestProject({
          rootDirectory: BASIC_REACT_DIRECTORY,
          hasTanStackQuery: true,
        }),
        includePaths: [
          path.join(BASIC_REACT_DIRECTORY, "src/tanstack-query-destructure.tsx"),
          path.join(BASIC_REACT_DIRECTORY, "src/convex-query-usage.tsx"),
        ],
      });
      const destructureFindings = scopedDiagnostics.filter(
        (diagnostic) => diagnostic.rule === "query-destructure-result",
      );
      expect(
        destructureFindings.some((diagnostic) =>
          diagnostic.filePath.includes("tanstack-query-destructure"),
        ),
      ).toBe(true);
      expect(
        destructureFindings.some((diagnostic) =>
          diagnostic.filePath.includes("convex-query-usage"),
        ),
      ).toBe(false);
    });

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
        category: "Bugs",
      },
      "query-no-rest-destructuring": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "Bugs",
      },
      "query-no-void-query-fn": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "Bugs",
      },
      "query-no-query-in-effect": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "Bugs",
      },
      "query-mutation-missing-invalidation": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "Bugs",
      },
      "query-no-usequery-for-mutation": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        category: "Bugs",
      },
    },
    () => basicReactDiagnostics,
  );
});
