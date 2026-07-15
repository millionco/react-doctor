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

  it("does not assign native Intl semantics to local lookalikes", () => {
    for (const code of [
      `class NumberFormat {
  constructor(public readonly token: string) {}
}
const Intl = { NumberFormat };
export const buildLocalFormatters = (values: string[]): NumberFormat[] =>
  values.map((value) => new Intl.NumberFormat(value));`,
      `function buildFormatter(Intl) { return new Intl.NumberFormat("local"); }`,
      `class Intl { static NumberFormat = class {}; }
function buildFormatter() { return new Intl.NumberFormat(); }`,
      `function Intl() {}
Intl.NumberFormat = class {};
function buildFormatter() { return new Intl.NumberFormat(); }`,
      `import Intl from "custom-intl";
function buildFormatter() { return new Intl.NumberFormat(); }`,
      `import * as Intl from "custom-intl";
function buildFormatter() { return new Intl.NumberFormat(); }`,
      `import { formatterNamespace as Intl } from "custom-intl";
function buildFormatter() { return new Intl.NumberFormat(); }`,
      `const { Intl } = customRuntime;
function buildFormatter() { return new Intl.NumberFormat(); }`,
      `function buildFormatter() {
  const Intl = { NumberFormat: class {} };
  return new Intl.NumberFormat();
}`,
    ]) {
      const result = runRule(jsHoistIntl, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("retains native Intl diagnostics beside a shadowed control", () => {
    const result = runRule(
      jsHoistIntl,
      `function buildNativeFormatter() { return new Intl.NumberFormat("en-US"); }
function buildLocalFormatter(Intl) { return new Intl.NumberFormat("local"); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("stays silent on a discarded validity probe inside try/catch", () => {
    const result = runRule(
      jsHoistIntl,
      `const handleSave = async (tz) => {
  let isValid = false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    isValid = true;
  } catch { isValid = false; }
  return isValid;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a USED formatter constructed inside try/catch", () => {
    const result = runRule(
      jsHoistIntl,
      `function fmt(n) {
  try {
    return new Intl.NumberFormat('en-US').format(n);
  } catch {
    return String(n);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a utility merging a caller options parameter", () => {
    const result = runRule(
      jsHoistIntl,
      `export function formatNumberWithCommas(input, locale = 'en-US', options) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 20,
    ...options,
  }).format(input);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a component spreading a props options object", () => {
    const result = runRule(
      jsHoistIntl,
      `const Price = ({ locale, options, value }) => {
  const text = new Intl.NumberFormat(locale, { ...options }).format(value);
  return text;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a utility spreading a LOCAL options object", () => {
    const result = runRule(
      jsHoistIntl,
      `function fmt(n) {
  const defaults = { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('en-US', { ...defaults }).format(n);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
