import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnsafeJsonParseImmediateMemberAccess } from "./no-unsafe-json-parse-immediate-member-access.js";

describe("no-unsafe-json-parse-immediate-member-access", () => {
  it("flags a property read on JSON.parse (Faire return-order shape)", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const message = JSON.parse(schedule.api_response).error.message;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an index/length access on JSON.parse", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const count = JSON.parse(raw).length;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags computed index access on JSON.parse", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const first = JSON.parse(raw)[0];`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the JSON.parse(JSON.stringify()) clone idiom", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const clone = JSON.parse(JSON.stringify(original)).value;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a `?? "{}"` fallback argument', () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const value = JSON.parse(input ?? "{}").value;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a `|| "[]"` fallback argument', () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const length = JSON.parse(input || "[]").length;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when inside a try block", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `
      function read(raw) {
        try {
          return JSON.parse(raw).value;
        } catch {
          return null;
        }
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the result is annotated `as T` before access", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const value = (JSON.parse(raw) as Config).value;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the result is passed to a validator before access", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const value = schema.parse(JSON.parse(raw)).value;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag JSON.parse bound to a variable without immediate access", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const data = JSON.parse(raw);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when JSON is shadowed by a local binding", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `
      function read(raw) {
        const JSON = { parse: () => ({ value: 1 }) };
        return JSON.parse(raw).value;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when only nested deeper inside a non-try block", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `
      function read(raw) {
        if (raw) {
          return JSON.parse(raw).value;
        }
        return null;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a parse dereference inside a test file", () => {
    const result = runRule(
      noUnsafeJsonParseImmediateMemberAccess,
      `const count = JSON.parse(raw).length;`,
      { filename: "read.test.ts" }
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
