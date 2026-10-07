import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoHeadImport } from "./nextjs-no-head-import.js";

const HEAD_IMPORT_SOURCE = `import Head from "next/head";`;

describe("nextjs/nextjs-no-head-import — regressions", () => {
  it("stays silent for a pages-router repo mounted at /app", () => {
    const result = runRule(nextjsNoHeadImport, HEAD_IMPORT_SOURCE, {
      filename: "/app/pages/index.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a src/pages file in a repo mounted at /app", () => {
    const result = runRule(nextjsNoHeadImport, HEAD_IMPORT_SOURCE, {
      filename: "/app/src/pages/index.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags App Router files in a repo mounted at /app", () => {
    const result = runRule(nextjsNoHeadImport, HEAD_IMPORT_SOURCE, {
      filename: "/app/app/page.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags App Router files under a project directory", () => {
    const result = runRule(nextjsNoHeadImport, HEAD_IMPORT_SOURCE, {
      filename: "/proj/src/app/page.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent for a pages-router repo whose project root is /app", () => {
    const result = runRule(nextjsNoHeadImport, HEAD_IMPORT_SOURCE, {
      filename: "/app/pages/index.tsx",
      settings: { "react-doctor": { rootDirectory: "/app" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a top-level app/ file when the project root is /app", () => {
    const result = runRule(nextjsNoHeadImport, HEAD_IMPORT_SOURCE, {
      filename: "/app/app/page.tsx",
      settings: { "react-doctor": { rootDirectory: "/app" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("App Router project-relative boundary", () => {
  it.each([
    "pages/app/md.tsx",
    "src/pages/app/index.tsx",
    "components/app/head.tsx",
    "lib/app/view.tsx",
  ])("keeps next/head valid outside the App Router: %s", (relativePath) => {
    expect(
      runRule(nextjsNoHeadImport, HEAD_IMPORT_SOURCE, {
        filename: `/project/${relativePath}`,
        settings: { "react-doctor": { rootDirectory: "/project" } },
      }).diagnostics,
    ).toHaveLength(0);
  });
  it.each([
    "app/page.tsx",
    "src/app/page.tsx",
    "app/pages/app/page.tsx",
    "src/app/(site)/page.tsx",
  ])("retains App Router reports: %s", (relativePath) => {
    expect(
      runRule(nextjsNoHeadImport, HEAD_IMPORT_SOURCE, {
        filename: `/project/${relativePath}`,
        settings: { "react-doctor": { rootDirectory: "/project" } },
      }).diagnostics,
    ).toHaveLength(1);
  });
});
