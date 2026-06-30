import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsHoistIntl } from "./js-hoist-intl.js";

describe("js-performance/js-hoist-intl — regressions", () => {
  it("stays silent on a per-locale memoizing factory", () => {
    const result = runRule(
      jsHoistIntl,
      `const cache = new Map(); function getFormatter(locale) { if (!cache.has(locale)) cache.set(locale, new Intl.NumberFormat(locale)); return cache.get(locale); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an unconditional Intl allocation in a function body", () => {
    const result = runRule(
      jsHoistIntl,
      `function fmt(locale, n) { return new Intl.NumberFormat(locale).format(n); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: pushing a new Intl into an array is unkeyed accumulation, not a
  // memo — it must still be flagged.
  it("still flags a new Intl pushed into an array (not a keyed memo)", () => {
    const result = runRule(
      jsHoistIntl,
      `function build(locales) { const formatters = []; for (const locale of locales) { formatters.push(new Intl.NumberFormat(locale)); } return formatters; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
