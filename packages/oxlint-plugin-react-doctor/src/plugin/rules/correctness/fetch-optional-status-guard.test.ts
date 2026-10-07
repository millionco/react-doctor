import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchResponseUsedWithoutStatusCheck } from "./no-fetch-response-used-without-status-check.js";

describe("optional fetch status guards", () => {
  it.each([
    "if (!response?.ok) return null; return response.json();",
    "if (response?.ok) return response.json(); return null;",
    "if (!(response?.ok as boolean)) return null; return response.json();",
  ])("accepts a guarded body read: %s", (body) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `const load = async () => { const response = await fetch('/data'); ${body} };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "if (response?.ok) return null; return response.json();",
    "if (fallback || response?.ok) return response.json(); return null;",
    "if (!response?.ok) log(); return response.json();",
    "return response?.json();",
  ])("retains an unchecked body read: %s", (body) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `const load = async () => { const response = await fetch('/data'); ${body} };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
