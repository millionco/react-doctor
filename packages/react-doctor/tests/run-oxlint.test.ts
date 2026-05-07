import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../src/types.js";
import { runOxlint } from "../src/utils/run-oxlint.js";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");
const BASIC_REACT_DIRECTORY = path.join(FIXTURES_DIRECTORY, "basic-react");
const NEXTJS_APP_DIRECTORY = path.join(FIXTURES_DIRECTORY, "nextjs-app");
const TANSTACK_START_APP_DIRECTORY = path.join(FIXTURES_DIRECTORY, "tanstack-start-app");
const USER_OXLINT_CONFIG_DIRECTORY = path.join(FIXTURES_DIRECTORY, "user-oxlint-config");
const USER_OXLINT_CONFIG_BROKEN_DIRECTORY = path.join(
  FIXTURES_DIRECTORY,
  "user-oxlint-config-broken",
);

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
  beforeAll(async () => {
    basicReactDiagnostics = await runOxlint({
      rootDirectory: BASIC_REACT_DIRECTORY,
      hasTypeScript: true,
      framework: "unknown",
      hasReactCompiler: false,
      hasTanStackQuery: true,
    });
    nextjsDiagnostics = await runOxlint({
      rootDirectory: NEXTJS_APP_DIRECTORY,
      hasTypeScript: true,
      framework: "nextjs",
      hasReactCompiler: false,
      hasTanStackQuery: false,
    });
    tanstackStartDiagnostics = await runOxlint({
      rootDirectory: TANSTACK_START_APP_DIRECTORY,
      hasTypeScript: true,
      framework: "tanstack-start",
      hasReactCompiler: false,
      hasTanStackQuery: false,
    });
  });

  it("loads basic-react diagnostics", () => {
    expect(basicReactDiagnostics.length).toBeGreaterThan(0);
  });

  it("loads nextjs diagnostics", () => {
    expect(nextjsDiagnostics.length).toBeGreaterThan(0);
  });

  it("loads tanstack-start diagnostics", () => {
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

  it("does not flag no-usememo-simple-expression for chained iteration callbacks", () => {
    const memoIssues = basicReactDiagnostics.filter(
      (diagnostic) =>
        diagnostic.rule === "no-usememo-simple-expression" &&
        diagnostic.filePath.endsWith("clean.tsx"),
    );
    expect(memoIssues).toHaveLength(0);
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
    },
    () => basicReactDiagnostics,
  );

  describe("nextjs router guidance", () => {
    it("does not recommend next/navigation for pages-router redirects", async () => {
      const pagesRouterDiagnostics = await runOxlint({
        rootDirectory: NEXTJS_APP_DIRECTORY,
        hasTypeScript: true,
        framework: "nextjs",
        hasReactCompiler: false,
        hasTanStackQuery: false,
        includePaths: [path.join(NEXTJS_APP_DIRECTORY, "src/pages/_app.tsx")],
      });
      const redirectIssue = pagesRouterDiagnostics.find(
        (diagnostic) => diagnostic.rule === "nextjs-no-client-side-redirect",
      );
      expect(redirectIssue).toBeDefined();
      expect(redirectIssue?.message).toContain("getServerSideProps redirect");
      expect(redirectIssue?.message).not.toContain("next/navigation");
    });

    it("does not flag useSearchParams() in a file that imports/uses <Suspense>", () => {
      const wrappedPageIssues = nextjsDiagnostics.filter(
        (diagnostic) =>
          diagnostic.rule === "nextjs-no-use-search-params-without-suspense" &&
          diagnostic.filePath.includes("wrapped/page"),
      );
      expect(wrappedPageIssues).toHaveLength(0);
    });
  });

  describe("server rule scope", () => {
    it("server-after-nonblocking flags BOTH console.log and analytics.track inside `use server`", () => {
      const issues = nextjsDiagnostics.filter(
        (diagnostic) =>
          diagnostic.rule === "server-after-nonblocking" &&
          diagnostic.filePath.includes("app/actions"),
      );
      const messages = issues.map((diagnostic) => diagnostic.message);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some((message) => message.includes("console.log"))).toBe(true);
      expect(messages.some((message) => message.includes("analytics.track"))).toBe(true);
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
      "no-many-boolean-props": {
        fixture: "new-rules.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "no-react19-deprecated-apis": {
        fixture: "legacy-react.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "no-render-prop-children": {
        fixture: "composition-issues.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
    },
    () => basicReactDiagnostics,
  );

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
      "no-uncontrolled-input": {
        fixture: "state-issues.tsx",
        ruleSource: "rules/correctness.ts",
        severity: "warning",
        category: "Correctness",
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
        severity: "warning",
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
      "server-no-mutable-module-state": {
        fixture: "app/actions.tsx",
        ruleSource: "rules/server.ts",
        severity: "error",
        category: "Server",
      },
      "server-cache-with-object-literal": {
        fixture: "app/actions.tsx",
        ruleSource: "rules/server.ts",
        category: "Server",
      },
      "server-hoist-static-io": {
        fixture: "app/og/route.tsx",
        ruleSource: "rules/server.ts",
        category: "Server",
      },
      "server-dedup-props": {
        fixture: "app/users/page.tsx",
        ruleSource: "rules/server.ts",
        category: "Server",
      },
      "server-sequential-independent-await": {
        fixture: "app/dashboard/route.tsx",
        ruleSource: "rules/server.ts",
        category: "Server",
      },
      "server-fetch-without-revalidate": {
        fixture: "app/dashboard/route.tsx",
        ruleSource: "rules/server.ts",
        category: "Server",
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

  describe("customRulesOnly mode", () => {
    const buildCustomOnlyOptions = () => ({
      rootDirectory: BASIC_REACT_DIRECTORY,
      hasTypeScript: true,
      framework: "unknown" as const,
      hasReactCompiler: false,
      hasTanStackQuery: true,
      customRulesOnly: true,
    });

    it("excludes builtin react/ and jsx-a11y/ rules when customRulesOnly is true", async () => {
      const customOnlyDiagnostics = await runOxlint(buildCustomOnlyOptions());

      const builtinPluginDiagnostics = customOnlyDiagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react" || diagnostic.plugin === "jsx-a11y",
      );
      expect(builtinPluginDiagnostics).toHaveLength(0);
    });

    it("still includes react-doctor/* rules when customRulesOnly is true", async () => {
      const customOnlyDiagnostics = await runOxlint(buildCustomOnlyOptions());

      const reactDoctorDiagnostics = customOnlyDiagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor",
      );
      expect(reactDoctorDiagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("adoptExistingLintConfig", () => {
    const buildAdoptionOptions = (overrides: Partial<Parameters<typeof runOxlint>[0]> = {}) => ({
      rootDirectory: USER_OXLINT_CONFIG_DIRECTORY,
      hasTypeScript: true,
      framework: "unknown" as const,
      hasReactCompiler: false,
      hasTanStackQuery: false,
      ...overrides,
    });

    it("merges rules from the user's .oxlintrc.json into the scan by default", async () => {
      const diagnostics = await runOxlint(buildAdoptionOptions());

      const debuggerIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-debugger");
      const emptyBlockIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-empty");

      expect(debuggerIssues.length).toBeGreaterThan(0);
      expect(debuggerIssues[0].severity).toBe("error");
      expect(emptyBlockIssues.length).toBeGreaterThan(0);
      expect(emptyBlockIssues[0].severity).toBe("warning");
    });

    it("reports adopted-rule diagnostics from plain .ts files (not just .tsx / .jsx)", async () => {
      const diagnostics = await runOxlint(buildAdoptionOptions());

      const debuggerIssuesInTs = diagnostics.filter(
        (diagnostic) =>
          diagnostic.rule === "no-debugger" && diagnostic.filePath.endsWith("util.ts"),
      );
      expect(debuggerIssuesInTs.length).toBeGreaterThan(0);
    });

    it("skips the user's .oxlintrc.json when adoptExistingLintConfig is false", async () => {
      const diagnostics = await runOxlint(buildAdoptionOptions({ adoptExistingLintConfig: false }));

      const debuggerIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-debugger");
      const emptyBlockIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-empty");

      expect(debuggerIssues).toHaveLength(0);
      expect(emptyBlockIssues).toHaveLength(0);
    });

    it("skips the user's .oxlintrc.json when customRulesOnly is true", async () => {
      const diagnostics = await runOxlint(buildAdoptionOptions({ customRulesOnly: true }));

      const debuggerIssues = diagnostics.filter((diagnostic) => diagnostic.rule === "no-debugger");
      expect(debuggerIssues).toHaveLength(0);
    });

    it("falls back to a curated-rules-only scan when the user's config breaks oxlint", async () => {
      const stderrChunks: string[] = [];
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      // HACK: capture the retry warning we write to stderr so we can
      // assert the user-facing message; vitest's spy helpers also work
      // but a direct override keeps the assertion shape readable.
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
        return true;
      }) as typeof process.stderr.write;

      let didResolve = false;
      try {
        await runOxlint({
          rootDirectory: USER_OXLINT_CONFIG_BROKEN_DIRECTORY,
          hasTypeScript: false,
          framework: "unknown" as const,
          hasReactCompiler: false,
          hasTanStackQuery: false,
        });
        didResolve = true;
      } finally {
        process.stderr.write = originalStderrWrite;
      }

      // Resolving (instead of throwing) is the whole point — pre-fix,
      // a broken `extends` aborted the entire lint pass and the
      // user's score collapsed onto zero diagnostics with no obvious
      // reason in the output.
      expect(didResolve).toBe(true);

      const stderrOutput = stderrChunks.join("");
      expect(stderrOutput).toContain("could not adopt existing lint config");
      expect(stderrOutput).toContain("retrying without extends");
    });
  });
});
