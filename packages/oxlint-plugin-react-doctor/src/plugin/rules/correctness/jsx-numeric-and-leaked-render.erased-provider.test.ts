import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNumericAndLeakedRender } from "./jsx-numeric-and-leaked-render.js";

const renderCount = `
const useRows = (rows) => {
  const total = Array.isArray(rows) ? rows.length : undefined;
  return { total };
};
export const RowSummary = ({ rows }) => {
  const { total } = useRows(rows);
  return <section>{total && <output>Rows</output>}</section>;
};`;

const scenarios = [
  { name: "preserves the native count warning", prefix: "", expected: 1 },
  {
    name: "rejects a direct provider replacement",
    prefix: "globalThis.Array.isArray = () => false;",
    expected: 0,
  },
  {
    name: "rejects an ambient carrier replacement",
    prefix: "declare const globalThis: any; globalThis.Array.isArray = () => false;",
    expected: 0,
  },
  {
    name: "rejects an interface carrier replacement",
    prefix: "interface globalThis {} globalThis.Array.isArray = () => false;",
    expected: 0,
  },
  {
    name: "rejects a type-only carrier replacement",
    prefix: 'import type globalThis from "provider-types"; globalThis.Array.isArray = () => false;',
    expected: 0,
  },
  {
    name: "rejects an erased carrier alias",
    prefix:
      "declare const globalThis: any; const environment = globalThis; environment.Array.isArray = () => false;",
    expected: 0,
  },
  {
    name: "rejects an ambient loader replacement",
    prefix: 'declare const require: any; require("react").useState = () => [false, () => {}];',
    expected: 0,
  },
  {
    name: "preserves an inert carrier declaration",
    prefix: "declare const globalThis: any;",
    expected: 1,
  },
  { name: "preserves an inert loader declaration", prefix: "interface require {}", expected: 1 },
  {
    name: "preserves a genuine local carrier",
    prefix:
      "const globalThis = { Array: { isArray: () => true } }; globalThis.Array.isArray = () => false;",
    expected: 1,
  },
];

describe("numeric local hook erased provider admission", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(jsxNumericAndLeakedRender, `${scenario.prefix}\n${renderCount}`, {
        filename: "row-summary.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
