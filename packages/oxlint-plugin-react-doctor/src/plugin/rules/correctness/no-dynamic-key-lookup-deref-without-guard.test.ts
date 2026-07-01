import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDynamicKeyLookupDerefWithoutGuard } from "./no-dynamic-key-lookup-deref-without-guard.js";

describe("no-dynamic-key-lookup-deref-without-guard", () => {
  it("flags a member deref off a cast-keyed lookup", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `const home = ROLE_HOME_URL[role as Role].path;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a call chained onto a cast-keyed lookup", () => {
    const result = runRule(noDynamicKeyLookupDerefWithoutGuard, `dict[view as View]();`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a destructure off a cast-keyed lookup", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `const { field } = record[id as string];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a lookup whose key binding is initialized by a cast", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `const role = token.role as Role; const home = ROLE_HOME_URL[role].path;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an array index deref", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `const next = items[nextIndex].id;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a key drawn by iterating the same object", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `Object.keys(windows).forEach((k) => windows[k].close());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an accumulator target lookup", () => {
    const result = runRule(noDynamicKeyLookupDerefWithoutGuard, `acc[groupKey].push(row);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain typed Record lookup", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `const color = REQUEST_TYPES[type].color; const label = THEME_MODES[mode].label;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a lookup with a dominating presence check", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `if (buckets[age]) buckets[age].push(item);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cast-keyed lookup guarded by a key-in-map check", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `if (role in ROLE_HOME_URL) { const h = ROLE_HOME_URL[role as Role].path; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a cast-keyed lookup optional-chained at the deref boundary", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `const home = ROLE_HOME_URL[role as Role]?.path;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a numeric-index cast", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `const v = items[i as number].value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("is skipped in test files", () => {
    const result = runRule(
      noDynamicKeyLookupDerefWithoutGuard,
      `const value = tokens[name as string].$value;`,
      { filename: "/repo/scripts/system-token/convert-tokens.cjs" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
