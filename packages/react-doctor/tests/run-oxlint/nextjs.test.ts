import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../../src/types/diagnostic.js";
import { runOxlint } from "../../src/core/runners/run-oxlint.js";
import { buildTestProject } from "../regressions/_helpers.js";
import { NEXTJS_APP_DIRECTORY, describeRules } from "./_helpers.js";

let nextjsDiagnostics: Diagnostic[];

describe("runOxlint", () => {
  beforeAll(async () => {
    nextjsDiagnostics = await runOxlint({
      rootDirectory: NEXTJS_APP_DIRECTORY,
      project: buildTestProject({
        rootDirectory: NEXTJS_APP_DIRECTORY,
        framework: "nextjs",
      }),
    });
  });

  it("loads nextjs diagnostics", () => {
    expect(nextjsDiagnostics.length).toBeGreaterThan(0);
  });

  describe("nextjs router guidance", () => {
    it("does not recommend next/navigation for pages-router redirects", async () => {
      const pagesRouterDiagnostics = await runOxlint({
        rootDirectory: NEXTJS_APP_DIRECTORY,
        project: buildTestProject({
          rootDirectory: NEXTJS_APP_DIRECTORY,
          framework: "nextjs",
        }),
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
});
