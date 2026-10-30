import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

const scenarios = [
  {
    name: "native baseline",
    code: "export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;",
    expected: 0,
  },
  {
    name: "genuine local value",
    code: "const RegExp = { note: 0 };RegExp.note = 1;export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;",
    expected: 0,
  },
  {
    name: "interface after genuine local value",
    code: "const RegExp = { note: 0 };interface RegExp {}RegExp.note = 1;export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;",
    expected: 0,
  },
  {
    name: "interface before genuine local value",
    code: "interface RegExp {}const RegExp = { note: 0 };RegExp.note = 1;export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;",
    expected: 0,
  },
  {
    name: "inner interface preserves outer runtime value",
    code: "const RegExp = { note: 0 };const inspectProvider = () => { interface RegExp {} RegExp.note = 1; };export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;",
    expected: 0,
  },
  {
    name: "type-only import equals cannot mask runtime mutation",
    code: 'import type RegExp = require("provider-types");RegExp.prototype.exec = () => null;export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;',
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace RegExp {}",
    code: "namespace RegExp {}RegExp.prototype.exec = () => null;export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;",
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace RegExp { export interface Marker {} }",
    code: "namespace RegExp { export interface Marker {} }RegExp.prototype.exec = () => null;export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;",
    expected: 1,
  },
  {
    name: "erased namespace cannot mask mutation: namespace RegExp { export namespace Nested { export interface Marker {} } }",
    code: "namespace RegExp { export namespace Nested { export interface Marker {} } }RegExp.prototype.exec = () => null;export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;",
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
