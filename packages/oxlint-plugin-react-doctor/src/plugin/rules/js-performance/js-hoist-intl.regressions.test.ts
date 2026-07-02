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

  // fp-review PR #994: the cache-memo exemption must be correlated with an
  // actual cache read/write, not token-based.
  it("stays silent on the get-check-set memo idiom with plain assignment", () => {
    const result = runRule(
      jsHoistIntl,
      `const cache = new Map();
function getFormatter(locale) {
  let formatter = cache.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale);
    cache.set(locale, formatter);
  }
  return formatter;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on `cache[k] ?? (cache[k] = new Intl…)`", () => {
    const result = runRule(
      jsHoistIntl,
      `const cache = {};
function getFormatter(locale) {
  return cache[locale] ?? (cache[locale] = new Intl.NumberFormat(locale));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on `cache.get(k) ?? (backing[k] = new Intl…)`", () => {
    const result = runRule(
      jsHoistIntl,
      `const cache = new Map();
const backing = {};
function getFormatter(locale) {
  return cache.get(locale) ?? (backing[locale] = new Intl.NumberFormat(locale));
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the ternary `cache.has(k) ? cache.get(k) : new Intl…` guard", () => {
    const result = runRule(
      jsHoistIntl,
      `const cache = new Map();
function getFormatter(locale) {
  return cache.has(locale) ? cache.get(locale) : new Intl.NumberFormat(locale);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an allocation guarded by an unrelated `.includes` if-test (no cache write)", () => {
    const result = runRule(
      jsHoistIntl,
      `function formatPrice(label, value, locale) {
  if (label.includes("price")) {
    return new Intl.NumberFormat(locale).format(value);
  }
  return String(value);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a `.set` that stores the formatted string, not the formatter", () => {
    const result = runRule(
      jsHoistIntl,
      `function buildUrl(url, total) {
  url.searchParams.set("total", new Intl.NumberFormat("en-US").format(total));
  return url;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a `.set` into a fresh per-call Map (no reuse across calls)", () => {
    const result = runRule(
      jsHoistIntl,
      `function buildFormatters(locales) {
  const byLocale = new Map();
  for (const locale of locales) {
    byLocale.set(locale, new Intl.NumberFormat(locale));
  }
  return byLocale;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
