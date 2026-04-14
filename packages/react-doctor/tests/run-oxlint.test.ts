import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/types.js";
import { runOxlint } from "../src/utils/run-oxlint.js";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");
const BASIC_REACT_DIRECTORY = path.join(FIXTURES_DIRECTORY, "basic-react");
const NEXTJS_APP_DIRECTORY = path.join(FIXTURES_DIRECTORY, "nextjs-app");
const TANSTACK_START_APP_DIRECTORY = path.join(FIXTURES_DIRECTORY, "tanstack-start-app");

const findDiagnosticsByRule = (diagnostics: Diagnostic[], rule: string): Diagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.rule === rule);

interface RuleTestCase {
  fixture: string;
  ruleSource: string;
  severity?: "error" | "warning";
  category?: string;
}

const describeRules = (
  groupName: string,
  rules: Record<string, RuleTestCase>,
  getDiagnostics: () => Diagnostic[],
) => {
  describe(groupName, () => {
    for (const [ruleName, testCase] of Object.entries(rules)) {
      it(`${ruleName} (${testCase.fixture} → ${testCase.ruleSource})`, () => {
        const issues = findDiagnosticsByRule(getDiagnostics(), ruleName);
        expect(issues.length).toBeGreaterThan(0);
        if (testCase.severity) expect(issues[0].severity).toBe(testCase.severity);
        if (testCase.category) expect(issues[0].category).toBe(testCase.category);
      });
    }
  });
};

let basicReactDiagnostics: Diagnostic[];
let nextjsDiagnostics: Diagnostic[];
let tanstackStartDiagnostics: Diagnostic[];

describe("runOxlint", () => {
  it("loads basic-react diagnostics", async () => {
    basicReactDiagnostics = await runOxlint(BASIC_REACT_DIRECTORY, true, "unknown", false);
    expect(basicReactDiagnostics.length).toBeGreaterThan(0);
  });

  it("loads nextjs diagnostics", async () => {
    nextjsDiagnostics = await runOxlint(NEXTJS_APP_DIRECTORY, true, "nextjs", false);
    expect(nextjsDiagnostics.length).toBeGreaterThan(0);
  });

  it("loads tanstack-start diagnostics", async () => {
    tanstackStartDiagnostics = await runOxlint(
      TANSTACK_START_APP_DIRECTORY,
      true,
      "tanstack-start",
      false,
    );
    expect(tanstackStartDiagnostics.length).toBeGreaterThan(0);
  });

  it("returns diagnostics with required fields", () => {
    for (const diagnostic of basicReactDiagnostics) {
      expect(diagnostic).toHaveProperty("filePath");
      expect(diagnostic).toHaveProperty("plugin");
      expect(diagnostic).toHaveProperty("rule");
      expect(diagnostic).toHaveProperty("severity");
      expect(diagnostic).toHaveProperty("message");
      expect(diagnostic).toHaveProperty("category");
      expect(["error", "warning"]).toContain(diagnostic.severity);
      expect(diagnostic.message.length).toBeGreaterThan(0);
    }
  });

  it("only reports diagnostics from JSX/TSX files", () => {
    for (const diagnostic of basicReactDiagnostics) {
      expect(diagnostic.filePath).toMatch(/\.(tsx|jsx)$/);
    }
  });

  describeRules(
    "state & effects rules",
    {
      "no-derived-state-effect": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "error",
        category: "State & Effects",
      },
      "no-fetch-in-effect": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "error",
      },
      "no-cascading-set-state": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/state-and-effects.ts",
        severity: "warning",
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
    },
    () => basicReactDiagnostics,
  );

  describeRules(
    "architecture rules",
    {
      "no-giant-component": {
        fixture: "giant-component.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "no-render-in-render": {
        fixture: "architecture-issues.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "no-nested-component-definition": {
        fixture: "architecture-issues.tsx",
        ruleSource: "rules/architecture.ts",
        severity: "error",
      },
    },
    () => basicReactDiagnostics,
  );

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

  describeRules(
    "bundle size rules",
    {
      "no-full-lodash-import": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
        category: "Bundle Size",
      },
      "no-moment": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
      "use-lazy-motion": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
      "prefer-dynamic-import": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
      "no-undeferred-third-party": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
    },
    () => basicReactDiagnostics,
  );

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
    },
    () => basicReactDiagnostics,
  );

  describeRules(
    "security rules",
    {
      "no-secrets-in-client-code": {
        fixture: "security-issues.tsx",
        ruleSource: "rules/security.ts",
        severity: "error",
        category: "Security",
      },
    },
    () => basicReactDiagnostics,
  );

  describeRules(
    "nextjs rules",
    {
      "nextjs-no-img-element": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
        category: "Next.js",
      },
      "nextjs-async-client-component": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
        severity: "error",
      },
      "nextjs-no-a-element": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-use-search-params-without-suspense": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-client-fetch-for-server-data": {
        fixture: "app/layout.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-missing-metadata": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-client-side-redirect": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-redirect-in-try-catch": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-image-missing-sizes": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-native-script": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-inline-script-missing-id": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-font-link": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-css-link": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-polyfill-script": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
      },
      "nextjs-no-head-import": {
        fixture: "app/page.tsx",
        ruleSource: "rules/nextjs.ts",
        severity: "error",
      },
      "nextjs-no-side-effect-in-get-handler": {
        fixture: "app/logout/route.tsx",
        ruleSource: "rules/nextjs.ts",
        severity: "error",
      },
      "server-auth-actions": {
        fixture: "app/actions.tsx",
        ruleSource: "rules/server.ts",
        severity: "error",
        category: "Server",
      },
      "server-after-nonblocking": {
        fixture: "app/actions.tsx",
        ruleSource: "rules/server.ts",
      },
    },
    () => nextjsDiagnostics,
  );

  describeRules(
    "tanstack-query rules",
    {
      "query-stable-query-client": {
        fixture: "src/query-issues.tsx",
        ruleSource: "rules/tanstack-query.ts",
        severity: "error",
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
  });

  describe("customRulesOnly mode", () => {
    it("excludes builtin react/ and jsx-a11y/ rules when customRulesOnly is true", async () => {
      const customOnlyDiagnostics = await runOxlint(
        BASIC_REACT_DIRECTORY,
        true,
        "unknown",
        false,
        undefined,
        undefined,
        true,
      );

      const builtinPluginDiagnostics = customOnlyDiagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react" || diagnostic.plugin === "jsx-a11y",
      );
      expect(builtinPluginDiagnostics).toHaveLength(0);
    });

    it("still includes react-doctor/* rules when customRulesOnly is true", async () => {
      const customOnlyDiagnostics = await runOxlint(
        BASIC_REACT_DIRECTORY,
        true,
        "unknown",
        false,
        undefined,
        undefined,
        true,
      );

      const reactDoctorDiagnostics = customOnlyDiagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor",
      );
      expect(reactDoctorDiagnostics.length).toBeGreaterThan(0);
    });
  });
});
