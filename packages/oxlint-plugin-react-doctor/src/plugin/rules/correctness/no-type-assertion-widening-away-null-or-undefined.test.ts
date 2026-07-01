import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTypeAssertionWideningAwayNullOrUndefined } from "./no-type-assertion-widening-away-null-or-undefined.js";

describe("no-type-assertion-widening-away-null-or-undefined", () => {
  it("flags an optional-chain assertion interpolated into a template", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      "const fallbackValue = defaultCountry ? `+${COUNTRIES[defaultCountry]?.[0] as string}` : '';",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an optional-access assertion immediately dereferenced", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const width = (row?.dimensions as Dimensions).width;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a nullable-annotated identifier asserted and passed as a JSX prop", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const selected: User | null | undefined = useSelectedUser(); const el = <Avatar user={selected as User} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when a trailing optional chain re-guards the value", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `(event?.target as HTMLElement)?.getBoundingClientRect();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the target keeps the nullable union", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const maybe = (record?.value as string | undefined).length;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when recovered by a following nullish coalesce", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const scale = properties?.scale as number ?? 1.0;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an assertion that is not immediately consumed", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const value = obj?.field as string;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cast through unknown", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const c = (globalThis?.foo as unknown).bar;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag as const", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const t = (obj?.value as const).length;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-nullable operand", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const width = (row.dimensions as Dimensions).width;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("is skipped in test files", () => {
    const result = runRule(
      noTypeAssertionWideningAwayNullOrUndefined,
      `const width = (row?.dimensions as Dimensions).width;`,
      { filename: "/repo/src/foo.test.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
