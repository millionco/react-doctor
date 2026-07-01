import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { intlTolocalestringNoLocaleArg } from "./intl-tolocalestring-no-locale-arg.js";

describe("intl-tolocalestring-no-locale-arg", () => {
  it("flags new Date(x).toLocaleDateString() with no arguments", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = new Date(x).toLocaleDateString();`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags value.toLocaleString() with no arguments", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = value.toLocaleString();`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags totalCount.toLocaleString() with no arguments", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = totalCount.toLocaleString();`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags toDate(x).toLocaleTimeString() with no arguments", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = toDate(x).toLocaleTimeString();`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag toLocaleDateString with an explicit locale", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = d.toLocaleDateString('en-US', { year: 'numeric' });`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag toLocaleString with undefined and options", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = n.toLocaleString(undefined, { minimumFractionDigits: 2 });`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag toLocaleString with a locale variable", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = d.toLocaleString(locale);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag String#toLocaleLowerCase", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = name.toLocaleLowerCase();`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag toLocaleUpperCase", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = name.toLocaleUpperCase();`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in test files", () => {
    const result = runRule(
      intlTolocalestringNoLocaleArg,
      `const s = value.toLocaleString();`,
      {
        filename: "summary.test.tsx",
      }
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
