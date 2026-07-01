import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnsafeJsonParse } from "./no-unsafe-json-parse.js";

describe("no-unsafe-json-parse", () => {
  it("flags immediate member access on the parse result", () => {
    const result = runRule(noUnsafeJsonParse, `const m = JSON.parse(raw).foo;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained member access on the parse result", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const m = JSON.parse(schedule.api_response).error.message;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags member access through parentheses", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const m = (JSON.parse(raw)).foo;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a network-text parse dereference outside try", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const id = JSON.parse(networkText).id;`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a bare assignment with no member access", () => {
    const result = runRule(noUnsafeJsonParse, `const data = JSON.parse(raw);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse/stringify round-trip clone", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const copy = JSON.parse(JSON.stringify(value)).foo;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse dereference inside an enclosing try block", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `try { const m = JSON.parse(raw).foo; } catch (error) { handle(error); }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the result is annotated with an as-cast", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const m = (JSON.parse(raw) as Payload).error;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the result is wrapped in a validator", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const parsed = schema.parse(JSON.parse(raw));`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse passed as a call argument", () => {
    const result = runRule(noUnsafeJsonParse, `doThing(JSON.parse(raw));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a `?? "{}"` fallback argument', () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const value = JSON.parse(input ?? "{}").value;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a `|| "[]"` fallback argument', () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const length = JSON.parse(input || "[]").length;`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when JSON is shadowed by a local binding", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `
      function read(raw) {
        const JSON = { parse: () => ({ value: 1 }) };
        return JSON.parse(raw).value;
      }
      `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse dereference inside a test file", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const m = JSON.parse(raw).foo;`,
      {
        filename: "payload.test.ts",
      }
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
