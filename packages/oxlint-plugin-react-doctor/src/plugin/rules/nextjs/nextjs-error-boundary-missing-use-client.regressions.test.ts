import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsErrorBoundaryMissingUseClient } from "./nextjs-error-boundary-missing-use-client.js";

const ERROR_BOUNDARY_SOURCE = `export default function ErrorBoundary({ error, reset }) {
  return <div>{error.message}</div>;
}`;

describe("nextjs/nextjs-error-boundary-missing-use-client — regressions", () => {
  it("flags app/error.tsx without the use client directive", () => {
    const result = runRule(nextjsErrorBoundaryMissingUseClient, ERROR_BOUNDARY_SOURCE, {
      filename: "/app/app/error.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a nested route error file too", () => {
    const result = runRule(nextjsErrorBoundaryMissingUseClient, ERROR_BOUNDARY_SOURCE, {
      filename: "/app/app/dashboard/error.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the directive is present", () => {
    const result = runRule(
      nextjsErrorBoundaryMissingUseClient,
      `"use client";
${ERROR_BOUNDARY_SOURCE}`,
      { filename: "/app/app/error.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on non-error-boundary files in app/", () => {
    const result = runRule(nextjsErrorBoundaryMissingUseClient, ERROR_BOUNDARY_SOURCE, {
      filename: "/app/app/page.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent outside the app directory", () => {
    const result = runRule(nextjsErrorBoundaryMissingUseClient, ERROR_BOUNDARY_SOURCE, {
      filename: "/app/pages/error.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
