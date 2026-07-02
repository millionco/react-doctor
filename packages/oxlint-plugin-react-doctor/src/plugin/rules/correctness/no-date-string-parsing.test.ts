import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDateStringParsing } from "./no-date-string-parsing.js";

describe("no-date-string-parsing", () => {
  it("flags new Date with a word-format string literal", () => {
    const result = runRule(noDateStringParsing, `const d = new Date("Jan 5 2021");`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new Date with a slash-format string literal", () => {
    const result = runRule(noDateStringParsing, `const d = new Date('01/02/2021');`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Date.parse on a calendar-invalid date-only literal", () => {
    const result = runRule(noDateStringParsing, `const ts = Date.parse("2021-02-30");`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new Date on a calendar-invalid Feb 29 in a non-leap year", () => {
    const result = runRule(noDateStringParsing, `const d = new Date("2021-02-29");`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("abstains on Date.parse with an unresolved runtime value (parse-then-validate idiom)", () => {
    const result = runRule(noDateStringParsing, `const ts = Date.parse(item.timestamp);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains on runtime Date.parse whose NaN result is explicitly validated", () => {
    const result = runRule(
      noDateStringParsing,
      `const ts = Date.parse(userInput); if (Number.isNaN(ts)) { throw new Error("invalid date"); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags new Date when an identifier resolves to a string literal", () => {
    const result = runRule(
      noDateStringParsing,
      `const dateString = "Jan 5 2021"; const d = new Date(dateString);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new Date with a no-substitution template literal", () => {
    const result = runRule(noDateStringParsing, "const d = new Date(`2021-02-15 00:00`);");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the space-separated ISO-ish local-vs-UTC case", () => {
    const result = runRule(noDateStringParsing, `const d = new Date("2021-02-15 00:00");`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a calendar-valid date-only literal (spec-deterministic UTC midnight since ES2016)", () => {
    const result = runRule(noDateStringParsing, `const d = new Date("2022-11-05");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.parse on a calendar-valid date-only literal", () => {
    const result = runRule(noDateStringParsing, `const ts = Date.parse("2027-04-26");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a calendar-valid Feb 29 in a leap year", () => {
    const result = runRule(noDateStringParsing, `const d = new Date("2024-02-29");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the deliberate new Date('') Invalid Date sentinel", () => {
    const result = runRule(noDateStringParsing, `const invalidDate = new Date("");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.parse('') used as a NaN sentinel", () => {
    const result = runRule(noDateStringParsing, `const nanSentinel = Date.parse("");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date with no argument", () => {
    const result = runRule(noDateStringParsing, `const d = new Date();`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date with a numeric epoch literal", () => {
    const result = runRule(noDateStringParsing, `const d = new Date(1609822800000);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the multi-arg numeric constructor", () => {
    const result = runRule(noDateStringParsing, `const d = new Date(2020, 2, 2);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date with a multi-arg numeric time constructor", () => {
    const result = runRule(noDateStringParsing, `const d = new Date(2021, 0, 5, 9, 30);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag copying a Date-instance binding", () => {
    const result = runRule(
      noDateStringParsing,
      `const other = new Date(); const copy = new Date(other);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an unresolved function parameter argument", () => {
    const result = runRule(
      noDateStringParsing,
      `function toDate(value) { return new Date(value); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier resolving to a number initializer", () => {
    const result = runRule(noDateStringParsing, `const ts = Date.now(); const d = new Date(ts);`);
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
      `import { parse } from 'date-fns'; const d = parse(s, 'MM/dd/yyyy', new Date());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .parse on a non-Date receiver", () => {
    const result = runRule(noDateStringParsing, `myDate.parse(s); customObj.parse(s);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-qualified ISO string with a Z designator", () => {
    const result = runRule(noDateStringParsing, `const d = new Date("2023-03-28T12:55:01.000Z");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fully-qualified ISO string with a numeric offset", () => {
    const result = runRule(noDateStringParsing, `const d = new Date("2023-03-28T12:55:01+02:00");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.parse on a fully-qualified ISO string with a Z designator", () => {
    const result = runRule(noDateStringParsing, `const ts = Date.parse("2026-06-21T08:00:00Z");`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.parse on a fully-qualified ISO string with a numeric offset", () => {
    const result = runRule(
      noDateStringParsing,
      `const ts = Date.parse("2023-03-28T12:55:01+02:00");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Date.parse when an identifier resolves to a deterministic ISO string", () => {
    const result = runRule(
      noDateStringParsing,
      `const iso = "2026-06-21T08:00:00Z"; const ts = Date.parse(iso);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains on a destructured prop with a string default (runtime prop, default only fills undefined)", () => {
    const result = runRule(
      noDateStringParsing,
      `const EventDate = ({ value = "" }) => new Date(value);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains on a function parameter with a string default (runtime argument wins)", () => {
    const result = runRule(
      noDateStringParsing,
      `function format(dateString = "2024-01-01") { return new Date(dateString); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains on a parameter default even when the default itself is ambiguous", () => {
    const result = runRule(
      noDateStringParsing,
      `function format(dateString = "Jan 5 2021") { return new Date(dateString); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains on the let-then-branch-assign pattern where the initializer is stale", () => {
    const result = runRule(
      noDateStringParsing,
      `let dateInput = "";
       if (typeof raw === "string") dateInput = raw; else dateInput = raw.toISOString();
       const d = new Date(dateInput);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains on a reassigned binding even when the initializer is an ambiguous literal", () => {
    const result = runRule(
      noDateStringParsing,
      `let dateInput = "Jan 5 2021";
       if (raw) dateInput = raw;
       const d = new Date(dateInput);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains on Date.parse of a binding reassigned to a runtime value after a safe initializer", () => {
    const result = runRule(
      noDateStringParsing,
      `let iso = "2026-06-21T08:00:00Z";
       iso = response.timestamp;
       const ts = Date.parse(iso);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a let binding with an ambiguous initializer and no reassignment", () => {
    const result = runRule(
      noDateStringParsing,
      `let dateString = "Jan 5 2021"; const d = new Date(dateString);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("abstains on an interpolated template literal", () => {
    const result = runRule(
      noDateStringParsing,
      "function toDate(raw) { const s = `${raw}`; return new Date(s); }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
