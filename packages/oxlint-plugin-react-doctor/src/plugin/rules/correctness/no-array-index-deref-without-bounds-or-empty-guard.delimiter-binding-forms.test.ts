import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

const scenarios = [
  {
    name: "native baseline",
    code: 'export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 0,
  },
  {
    name: "genuine local value",
    code: 'const String = { note: 0 };String.note = 1;export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 0,
  },
  {
    name: "interface after genuine local value",
    code: 'const String = { note: 0 };interface String {}String.note = 1;export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 0,
  },
  {
    name: "interface before genuine local value",
    code: 'interface String {}const String = { note: 0 };String.note = 1;export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 0,
  },
  {
    name: "inner interface preserves outer runtime value",
    code: 'const String = { note: 0 };const inspectProvider = () => { interface String {} String.note = 1; };export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 0,
  },
  {
    name: "type-only import equals cannot mask runtime mutation",
    code: 'import type String = require("provider-types");String.prototype.split = () => [];export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace String {}",
    code: 'namespace String {}String.prototype.split = () => [];export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace String { export interface Marker {} }",
    code: 'namespace String { export interface Marker {} }String.prototype.split = () => [];export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace String { export namespace Nested { export interface Marker {} } }",
    code: 'namespace String { export namespace Nested { export interface Marker {} } }String.prototype.split = () => [];export const readDelimitedLabel = (value: number) => { const text = value.toString(); const position = text.indexOf("."); return <span>{position !== -1 ? text.split(".")[1].length : 0}</span>; };',
    expected: 1,
  },
];
const options = {
  filename: "src/binding-forms.tsx",
  forceJsx: true,
};

describe("runtime and type binding namespaces", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, scenario.code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
