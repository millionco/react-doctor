import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDateStringParsing } from "./no-date-string-parsing.js";

describe("no-date-string-parsing", () => {
  it("flags new Date with a word-format string literal", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date("Jan 5 2021");`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new Date with a slash-format string literal", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date('01/02/2021');`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Date.parse on an ambiguous string literal", () => {
    const result = runRule(
      noDateStringParsing,
      `const ts = Date.parse("2021-02-30");`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Date.parse on an unresolved runtime value", () => {
    const result = runRule(
      noDateStringParsing,
      `const ts = Date.parse(item.timestamp);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new Date when an identifier resolves to a string literal", () => {
    const result = runRule(
      noDateStringParsing,
      `const dateString = "Jan 5 2021"; const d = new Date(dateString);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new Date with a no-substitution template literal", () => {
    const result = runRule(
      noDateStringParsing,
      "const d = new Date(`2021-02-15 00:00`);"
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the space-separated ISO-ish local-vs-UTC case", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date("2021-02-15 00:00");`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a date-only string literal", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date("2022-11-05");`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag new Date with no argument", () => {
    const result = runRule(noDateStringParsing, `const d = new Date();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date with a numeric epoch literal", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date(1609822800000);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the multi-arg numeric constructor", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date(2020, 2, 2);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date with a multi-arg numeric time constructor", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date(2021, 0, 5, 9, 30);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag copying a Date-instance binding", () => {
    const result = runRule(
      noDateStringParsing,
      `const other = new Date(); const copy = new Date(other);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an unresolved function parameter argument", () => {
    const result = runRule(
      noDateStringParsing,
      `function toDate(value) { return new Date(value); }`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier resolving to a number initializer", () => {
    const result = runRule(
      noDateStringParsing,
      `const ts = Date.now(); const d = new Date(ts);`
    );
    // The `Date.now()` call itself is not `Date.parse`, and `new Date(ts)`
    // resolves to a number, so nothing fires.
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.now", () => {
    const result = runRule(noDateStringParsing, `const ms = Date.now();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag date-fns parse", () => {
    const result = runRule(
      noDateStringParsing,
      `import { parse } from 'date-fns'; const d = parse(s, 'MM/dd/yyyy', new Date());`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .parse on a non-Date receiver", () => {
    const result = runRule(
      noDateStringParsing,
      `myDate.parse(s); customObj.parse(s);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-qualified ISO string with a Z designator", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date("2023-03-28T12:55:01.000Z");`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-qualified ISO string with a numeric offset", () => {
    const result = runRule(
      noDateStringParsing,
      `const d = new Date("2023-03-28T12:55:01+02:00");`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.parse on a fully-qualified ISO string with a Z designator", () => {
    const result = runRule(
      noDateStringParsing,
      `const ts = Date.parse("2026-06-21T08:00:00Z");`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.parse on a fully-qualified ISO string with a numeric offset", () => {
    const result = runRule(
      noDateStringParsing,
      `const ts = Date.parse("2023-03-28T12:55:01+02:00");`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.parse when an identifier resolves to a deterministic ISO string", () => {
    const result = runRule(
      noDateStringParsing,
      `const iso = "2026-06-21T08:00:00Z"; const ts = Date.parse(iso);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains on an interpolated template literal", () => {
    const result = runRule(
      noDateStringParsing,
      "function toDate(raw) { const s = `${raw}`; return new Date(s); }"
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
