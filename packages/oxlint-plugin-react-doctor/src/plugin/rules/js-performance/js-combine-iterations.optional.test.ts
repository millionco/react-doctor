import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCombineIterations } from "./js-combine-iterations.js";

interface OptionalChainCase {
  name: string;
  code: string;
  expected: number;
}

const cases: OptionalChainCase[] = [
  {
    name: "canonical from wrapper",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "canonical some wrapper",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.some(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "canonical none wrapper",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.none().filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "map then filter wrapper",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).map(item => item.label).filter(label => label.length > 0);',
    expected: 0,
  },
  {
    name: "mapped array remains wrapped",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).map(item => [item]).filter(items => items.length > 0);',
    expected: 0,
  },
  {
    name: "repeated wrapper calls",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label).filter(label => label.length > 0);',
    expected: 0,
  },
  {
    name: "transparent factory",
    code: 'import { Optional } from "@ephox/katamari"; const result = (Optional.from(value) as any).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "known firstChild binder",
    code: 'import { Optional } from "@ephox/katamari"; import { Traverse } from "@ephox/sugar"; const result = Optional.from(value).map(item => item.element).bind(Traverse.firstChild).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "renamed canonical providers",
    code: 'import { Optional as Maybe } from "@ephox/katamari"; import { Traverse as Tree } from "@ephox/sugar"; const result = Maybe.from(value).bind(Tree.firstChild).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "foreign provider",
    code: 'import { Optional } from "foreign-library"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "type-only provider",
    code: 'import type { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "default provider",
    code: 'import Optional from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "namespace provider",
    code: 'import * as Optional from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "local fake provider",
    code: "const Optional = makeProvider(); const result = Optional.from(value).filter(item => item.active).map(item => item.label);",
    expected: 1,
  },
  {
    name: "shadowed provider",
    code: 'import { Optional } from "@ephox/katamari"; const read = (Optional) => Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "ordinary array",
    code: "const result = items.filter(item => item.active).map(item => item.label);",
    expected: 1,
  },
  {
    name: "unknown binder",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).bind(convert).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "inline array binder",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).bind(item => [item]).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "inline wrapper binder",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).bind(item => Optional.some(item)).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "array conversion",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).toArray().filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "getOr conversion",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).getOr(items).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "getOrNull conversion",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).getOrNull().filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "fold conversion",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).fold(() => [], item => [item]).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "unknown method",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).flatMap(convert).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "foreign Traverse",
    code: 'import { Optional } from "@ephox/katamari"; import { Traverse } from "foreign-library"; const result = Optional.from(value).bind(Traverse.firstChild).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "type-only Traverse",
    code: 'import { Optional } from "@ephox/katamari"; import type { Traverse } from "@ephox/sugar"; const result = Optional.from(value).bind(Traverse.firstChild).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "unknown imported binder",
    code: 'import { Optional } from "@ephox/katamari"; import { child } from "@ephox/sugar"; const result = Optional.from(value).bind(child).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "aliased binder",
    code: 'import { Optional } from "@ephox/katamari"; import { Traverse } from "@ephox/sugar"; const child = Traverse.firstChild; const result = Optional.from(value).bind(child).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "factory replacement",
    code: 'import { Optional } from "@ephox/katamari"; Optional.from = replacement; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "prototype method replacement",
    code: 'import { Optional } from "@ephox/katamari"; Optional.prototype.map = replacement; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "returned instance mutation",
    code: 'import { Optional } from "@ephox/katamari"; Optional.from(value).filter = replacement; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "computed method mutation",
    code: 'import { Optional } from "@ephox/katamari"; target[method] = replacement; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "provider alias escape",
    code: 'import { Optional } from "@ephox/katamari"; const provider = Optional; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "provider argument escape",
    code: 'import { Optional } from "@ephox/katamari"; consume(Optional); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "provider destructuring",
    code: 'import { Optional } from "@ephox/katamari"; const { from } = Optional; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "provider method extraction",
    code: 'import { Optional } from "@ephox/katamari"; const factory = Optional.from; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "provider method call transport",
    code: 'import { Optional } from "@ephox/katamari"; Optional.from.call(null, value); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "Object reflection",
    code: 'import { Optional } from "@ephox/katamari"; Object.defineProperty(target, "map", descriptor); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "Reflect reflection",
    code: 'import { Optional } from "@ephox/katamari"; Reflect.set(target, "map", replacement); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "global namespace reflection",
    code: 'import { Optional } from "@ephox/katamari"; globalThis.Object.assign(target, replacement); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "dynamic eval",
    code: 'import { Optional } from "@ephox/katamari"; eval(programText); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "dynamic Function",
    code: 'import { Optional } from "@ephox/katamari"; Function(programText); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "require exposure",
    code: 'import { Optional } from "@ephox/katamari"; require(packageName); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "module import",
    code: 'import { Optional } from "@ephox/katamari"; import { createRequire } from "node:module"; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "constructor carrier",
    code: 'import { Optional } from "@ephox/katamari"; const compile = (() => {}).constructor; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "destructured constructor",
    code: 'import { Optional } from "@ephox/katamari"; const { constructor: compile } = callback; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "prototype carrier",
    code: 'import { Optional } from "@ephox/katamari"; const prototype = target.__proto__; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "Traverse method replacement",
    code: 'import { Optional } from "@ephox/katamari"; import { Traverse } from "@ephox/sugar"; Traverse.firstChild = replacement; const result = Optional.from(value).bind(Traverse.firstChild).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "optional factory",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from?.(value).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "optional map",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).map?.(item => item.label);',
    expected: 1,
  },
  {
    name: "spread factory",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(...values).filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "spread callback",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(...predicates).map(item => item.label);',
    expected: 1,
  },
  {
    name: "extra callback argument",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active, receiver).map(item => item.label);',
    expected: 1,
  },
  {
    name: "foreach outer",
    code: 'import { Optional } from "@ephox/katamari"; const result = Optional.from(value).filter(item => item.active).forEach(consume);',
    expected: 1,
  },
  {
    name: "readonly receiver alias unsupported",
    code: 'import { Optional } from "@ephox/katamari"; const optional = Optional.from(value); const result = optional.filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "mutable receiver alias unsupported",
    code: 'import { Optional } from "@ephox/katamari"; let optional = Optional.from(value); optional = items; const result = optional.filter(item => item.active).map(item => item.label);',
    expected: 1,
  },
  {
    name: "shadowed Object harmless",
    code: 'import { Optional } from "@ephox/katamari"; const Object = {}; consume(Object); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "shadowed eval harmless",
    code: 'import { Optional } from "@ephox/katamari"; const evaluate = (eval) => eval(programText); const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "provider in type position",
    code: 'import { Optional } from "@ephox/katamari"; type Wrapper = typeof Optional; const result = Optional.from(value).filter(item => item.active).map(item => item.label);',
    expected: 0,
  },
  {
    name: "additional canonical @ephox/katamari namespace carrier escape",
    code: 'import { Optional } from "@ephox/katamari"; import * as Carrier from "@ephox/katamari"; consume(Carrier.Optional); const result=Optional.from(value).filter(item=>item.active).map(item=>item.label);',
    expected: 1,
  },
  {
    name: "additional canonical @ephox/katamari default carrier escape",
    code: 'import { Optional } from "@ephox/katamari"; import Carrier from "@ephox/katamari"; consume(Carrier.Optional); const result=Optional.from(value).filter(item=>item.active).map(item=>item.label);',
    expected: 1,
  },
  {
    name: "additional canonical @ephox/sugar namespace carrier escape",
    code: 'import { Optional } from "@ephox/katamari"; import * as Carrier from "@ephox/sugar"; consume(Carrier.Traverse); const result=Optional.from(value).filter(item=>item.active).map(item=>item.label);',
    expected: 1,
  },
  {
    name: "additional canonical @ephox/sugar default carrier escape",
    code: 'import { Optional } from "@ephox/katamari"; import Carrier from "@ephox/sugar"; consume(Carrier.Traverse); const result=Optional.from(value).filter(item=>item.active).map(item=>item.label);',
    expected: 1,
  },
  {
    name: "type-only canonical namespace stays irrelevant",
    code: 'import { Optional } from "@ephox/katamari"; import type * as Carrier from "@ephox/katamari"; type Provider=typeof Carrier; const result=Optional.from(value).filter(item=>item.active).map(item=>item.label);',
    expected: 0,
  },
  {
    name: "unrelated named library imports remain admitted",
    code: 'import { Optional, Arr, Id, Type } from "@ephox/katamari"; consume(Arr,Id,Type); const result=Optional.from(value).filter(item=>item.active).map(item=>item.label);',
    expected: 0,
  },
];

describe("js-combine-iterations canonical Optional receivers", () => {
  for (const entry of cases) {
    it(entry.name, () => {
      const result = runRule(jsCombineIterations, entry.code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(entry.expected);
    });
  }
});
