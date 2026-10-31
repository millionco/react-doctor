import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNumericAndLeakedRender } from "./jsx-numeric-and-leaked-render.js";

const scenarios = [
  {
    name: "native baseline",
    code: "const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };",
    expected: 1,
  },
  {
    name: "genuine local value",
    code: "const globalThis = { note: 0 };globalThis.note = 1;const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };",
    expected: 1,
  },
  {
    name: "interface after genuine local value",
    code: "const globalThis = { note: 0 };interface globalThis {}globalThis.note = 1;const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };",
    expected: 1,
  },
  {
    name: "interface before genuine local value",
    code: "interface globalThis {}const globalThis = { note: 0 };globalThis.note = 1;const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };",
    expected: 1,
  },
  {
    name: "inner interface preserves outer runtime value",
    code: "const globalThis = { note: 0 };const inspectProvider = () => { interface globalThis {} globalThis.note = 1; };const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };",
    expected: 1,
  },
  {
    name: "type-only import equals cannot mask runtime mutation",
    code: 'import type globalThis = require("provider-types");globalThis.Array.isArray = () => false;const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };',
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis {}",
    code: "namespace globalThis {}globalThis.Array.isArray = () => false;const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };",
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis { export interface Marker {} }",
    code: "namespace globalThis { export interface Marker {} }globalThis.Array.isArray = () => false;const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };",
    expected: 0,
  },
  {
    name: "erased namespace cannot mask mutation: namespace globalThis { export namespace Nested { export interface Marker {} } }",
    code: "namespace globalThis { export namespace Nested { export interface Marker {} } }globalThis.Array.isArray = () => false;const useRows = (rows) => { const total = Array.isArray(rows) ? rows.length : undefined; return { total }; }; export const RowSummary = ({ rows }) => { const { total } = useRows(rows); return <section>{total && <output>Rows</output>}</section>; };",
    expected: 0,
  },
];
const options = {
  filename: "src/binding-forms.tsx",
  forceJsx: true,
};

describe("runtime and type binding namespaces", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(jsxNumericAndLeakedRender, scenario.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
