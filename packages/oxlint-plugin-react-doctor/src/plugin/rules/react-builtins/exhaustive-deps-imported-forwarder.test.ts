import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const RELAY = `
  import { useEffect } from "react";
  import { rateFor } from "store";
  export function Rates({ currencyTable, displayCurrency }) {
    const getRate = (symbol) => rateFor(currencyTable, symbol);
    useEffect(() => {
      ["GBP", "CAD"].forEach((symbol) => getRate(symbol));
    }, [currencyTable]);
    return getRate("EUR");
  }
`;

describe("exhaustive-deps imported function forwarding", () => {
  it("covers the relay with its captured binding in the curated passive effect", () => {
    const curated = runRule(exhaustiveDeps, RELAY);
    expect(curated.parseErrors).toEqual([]);
    expect(curated.diagnostics).toEqual([]);
    const upstream = runRule(exhaustiveDeps, RELAY, {
      settings: { "react-doctor": { portedRuleMode: "upstream" } },
    });
    expect(upstream.diagnostics).toHaveLength(1);
    expect(upstream.diagnostics[0]?.message).toContain("stale `getRate`");
  });

  it.each([
    ["omitted binding", "[currencyTable]", "[]"],
    ["property of the captured binding", "[currencyTable]", "[currencyTable.lastUpdate]"],
    [
      "another captured input",
      "rateFor(currencyTable, symbol)",
      "rateFor(displayCurrency, symbol)",
    ],
    ["default argument", "(symbol) => rateFor", "(symbol = displayCurrency) => rateFor"],
    ["property access", "rateFor(currencyTable, symbol)", "rateFor(currencyTable, symbol.name)"],
    [
      "optional provider call",
      "rateFor(currencyTable, symbol)",
      "rateFor?.(currencyTable, symbol)",
    ],
    ["mutable imported alternative", 'import { rateFor } from "store";', "let rateFor = quote;"],
    ["escaped function identity", 'return getRate("EUR");', "return getRate;"],
    ["uncertain helper invocation", 'return getRate("EUR");', 'return getRate?.("EUR");'],
    [
      "binding reassignment",
      'return getRate("EUR");',
      "currencyTable = displayCurrency; return null;",
    ],
    [
      "destructured assignment",
      'return getRate("EUR");',
      "({ table: currencyTable } = next); return null;",
    ],
    ["array assignment", 'return getRate("EUR");', "[currencyTable] = next; return null;"],
    [
      "destructured loop binding",
      'return getRate("EUR");',
      "for ([currencyTable] of next) {} return null;",
    ],
    ["dynamic lexical access", 'return getRate("EUR");', 'return eval("getRate");'],
    [
      "object destructuring default for the relay",
      "const getRate = (symbol) => rateFor(currencyTable, symbol);",
      "const { getRate = (symbol) => rateFor(currencyTable, symbol) } = overrides;",
    ],
    [
      "array destructuring default for the relay",
      "const getRate = (symbol) => rateFor(currencyTable, symbol);",
      "const [getRate = (symbol) => rateFor(currencyTable, symbol)] = overrides;",
    ],
  ])("retains the warning for %s", (_description, original, replacement) => {
    const result = runRule(exhaustiveDeps, RELAY.replace(original, replacement));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("stale `getRate`");
  });

  it("keeps the warning for a React namespace hook call", () => {
    const result = runRule(
      exhaustiveDeps,
      RELAY.replace(
        'import { useEffect } from "react";',
        'import * as React from "react";',
      ).replace("useEffect(()", "React.useEffect(()"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("stale `getRate`");
  });

  it("retains an unrelated missing dependency", () => {
    const result = runRule(
      exhaustiveDeps,
      RELAY.replace('["GBP", "CAD"].forEach', 'log(displayCurrency); ["GBP", "CAD"].forEach'),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("stale `displayCurrency`");
    expect(result.diagnostics[0]?.message).not.toContain("getRate");
  });

  it("requires the declared dependency to resolve to the same binding", () => {
    const result = runRule(
      exhaustiveDeps,
      RELAY.replace(
        "useEffect(() => {",
        "{ const currencyTable = displayCurrency; useEffect(() => {",
      ).replace("}, [currencyTable]);", "}, [currencyTable]); }"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("stale `getRate`");
  });
});
