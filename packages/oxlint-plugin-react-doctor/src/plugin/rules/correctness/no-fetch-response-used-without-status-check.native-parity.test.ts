import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchResponseUsedWithoutStatusCheck } from "./no-fetch-response-used-without-status-check.js";

describe("fetch status guard parity", () => {
  it.each([
    ["try { return body; } catch { return null; }", 0],
    ["try { return body; } catch { console.log('invalid'); }", 1],
    ["try { console.log('invalid'); } finally { return body; }", 0],
    ["if (true) return body;", 0],
  ])("preserves early exit proof for %s", (exit, expectedCount) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `export async function load() {
        const response = await fetch('/items');
        const body = await response.json();
        if (!response.ok) { ${exit} }
        return body;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each([
    ["response?.ok", 1],
    ["response.ok as boolean", 1],
    ["response", 1],
    ["response.ok", 0],
    ["((response.ok))", 0],
  ])("preserves canonical guard analysis for %s", (guard, expectedCount) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `export async function load() {
        let response;
        try { response = await fetch("/items"); } catch {}
        if (!(${guard})) throw new Error("failed");
        return response.json();
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
