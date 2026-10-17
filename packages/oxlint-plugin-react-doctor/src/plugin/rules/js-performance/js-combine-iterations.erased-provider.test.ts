import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCombineIterations } from "./js-combine-iterations.js";

const cases = [
  {
    name: "rejects native carrier alias provider rewriting",
    code: 'const world=globalThis; world.Object.defineProperty(world.require("@ephox/katamari").Optional,"from",{value:()=>[]});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "rejects erased carrier alias provider rewriting",
    code: 'declare const globalThis:any;const world=globalThis; world.Object.defineProperty(world.require("@ephox/katamari").Optional,"from",{value:()=>[]});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "preserves harmless erased carrier checks",
    code: 'declare const globalThis:any;typeof globalThis;void globalThis;import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "rejects an erased global carrier provider member",
    code: 'declare const globalThis:any;globalThis.Object.defineProperty(globalThis.require("@ephox/katamari").Optional,"from",{value:()=>[]});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "preserves unrelated erased global carrier references",
    code: 'declare const globalThis:any;globalThis.unrelated;import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "preserves an inert erased declaration",
    code: 'declare const Object: any;import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "rejects runtime provider rewriting after declare const Object: any;",
    code: 'declare const Object: any;declare const require: any; Object.defineProperty(require("@ephox/katamari").Optional, "from", {value: () => []});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "rejects runtime provider rewriting after interface Object {}",
    code: 'interface Object {}declare const require: any; Object.defineProperty(require("@ephox/katamari").Optional, "from", {value: () => []});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: 'rejects runtime provider rewriting after import type Object from "provider-types";',
    code: 'import type Object from "provider-types";declare const require: any; Object.defineProperty(require("@ephox/katamari").Optional, "from", {value: () => []});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "rejects type-only import-equals provider rewrites",
    code: 'import type Object = require("provider-types");Object.defineProperty({}, "unrelated", {value: 42});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "preserves genuine import-equals value binding",
    code: 'import Object = require("provider-values");Object.defineProperty({}, "unrelated", {value: 42});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "preserves genuine value binding with merged interface",
    code: 'const Object = {defineProperty: () => null, getPrototypeOf: () => ({})}; interface Object {}Object.defineProperty({}, "unrelated", {value: 42});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "rejects empty namespace provider masking",
    code: 'namespace Object {}Object.defineProperty({}, "unrelated", {value: 42});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "rejects type-only namespace provider masking",
    code: 'namespace Object { export interface Marker {} }Object.defineProperty({}, "unrelated", {value: 42});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "rejects nested type-only namespace provider masking",
    code: 'namespace Object { export namespace Nested { export type Marker = unknown; } }Object.defineProperty({}, "unrelated", {value: 42});import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "preserves an inert empty namespace",
    code: 'namespace Object {}import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "preserves a genuine runtime namespace",
    code: 'namespace Object { export const marker = 1; } void Object;import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
];

describe("erased runtime provider admission", () => {
  for (const scenario of cases) {
    it(scenario.name, () => {
      const result = runRule(jsCombineIterations, scenario.code, {
        filename: "provider-runtime.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
