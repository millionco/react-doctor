import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { isImmediatelyGuardedMapGet } from "./utils/is-immediately-guarded-map-get.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";

interface GuardedMapCase {
  name: string;
  source: string;
  expected: number;
  proofExpected: number;
}

const guardedMapCases: GuardedMapCase[] = [
  {
    name: "ambient-global-native-map-mutation",
    source:
      'declare const globalThis: any; Object.defineProperty(globalThis.Map.prototype, "get", { value: () => undefined }); const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "erased-interface-native-map-mutation",
    source:
      'interface globalThis {} Object.defineProperty(globalThis.Map.prototype, "get", { value: () => undefined }); const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "erased-type-import-native-map-mutation",
    source:
      'import type { globalThis } from "types"; Object.defineProperty(globalThis.Map.prototype, "get", { value: () => undefined }); const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "ambient-function-native-map-mutation",
    source:
      'declare const Function: any; Function("Map.prototype.get = () => undefined")(); const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "inert-ambient-global-keeps-map-proof",
    source:
      'declare const globalThis: any; const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "genuine-local-global-keeps-map-proof",
    source:
      'const globalThis = { Map: class {} }; Object.defineProperty(globalThis.Map.prototype, "get", { value: () => undefined }); const groups = new Map(); const selected = groups.get("group") ? groups.get("group")!.value : null;',
    expected: 0,
    proofExpected: 1,
  },

  {
    name: "string literal key",
    source: `const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "numeric literal key",
    source: `const groups = new Map(); const selected = groups.get(1) ? groups.get(1)!.value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "boolean literal key",
    source: `const groups = new Map(); const selected = groups.get(true) ? groups.get(true)!.value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "null literal key",
    source: `const groups = new Map(); const selected = groups.get(null) ? groups.get(null)!.value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "readonly key from unknown producer",
    source: `const groups = new Map(); const key = readKey(); const selected = groups.get(key) ? groups.get(key)!.value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "readonly object identity key",
    source: `const groups = new Map(); const key = {}; const selected = groups.get(key) ? groups.get(key)!.value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "transparent assertion and call wrappers",
    source: `const groups = new Map(); const key = 'group'; const selected = (groups.get(key)) ? ((groups.get(key)!)).value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "method call consequent",
    source: `const groups = new Map(); const key = 'group'; const selected = groups.get(key) ? groups.get(key)!.concat('item') : [];`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "nested population and closed conversion",
    source: `const groupItems = (items) => { const groups = new Map(); items.forEach((item) => { const key = item.group; groups.set(key, groups.get(key) ? groups.get(key)!.concat(item) : [item]); }); groups.forEach((values, key) => groups.set(key, values)); const entries = Array.from(groups); return entries; };`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "zero parameter map iteration",
    source: `const groups = new Map(); groups.forEach(() => {}); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "local unrelated Map shadow",
    source: `const groups = new Map(); const unrelated = () => { const Map = 1; return Map; }; const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "unguarded lookup",
    source: `const groups = new Map(); const selected = groups.get('group')!.value;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "different literal keys",
    source: `const groups = new Map(); const selected = groups.get('first') ? groups.get('second')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "different readonly bindings",
    source: `const groups = new Map(); const first = readKey(); const second = readKey(); const selected = groups.get(first) ? groups.get(second)!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "different maps",
    source: `const groups = new Map(); const other = new Map(); const selected = groups.get('group') ? other.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "mutable key",
    source: `const groups = new Map(); let key = 'group'; const selected = groups.get(key) ? groups.get(key)!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "parameter key",
    source: `const select = (key) => { const groups = new Map(); return groups.get(key) ? groups.get(key)!.value : null; };`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "key property getters",
    source: `const groups = new Map(); const selected = groups.get(input.key) ? groups.get(input.key)!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "repeated key calls",
    source: `const groups = new Map(); const selected = groups.get(readKey()) ? groups.get(readKey())!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "sequence invalidation",
    source: `const groups = new Map(); const selected = groups.get('group') ? (groups.delete('group'), groups.get('group')!.value) : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "call before asserted argument",
    source: `const groups = new Map(); const selected = groups.get('group') ? consume(groups.get('group')!.value) : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "assertion in alternate",
    source: `const groups = new Map(); const selected = groups.get('group') ? null : groups.get('group')!.value;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "computed guard method",
    source: `const groups = new Map(); const selected = groups['get']('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "method replacement",
    source: `const groups = new Map(); groups.get = customGet; const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "extracted method",
    source: `const groups = new Map(); const get = groups.get; const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "receiver returned afterward",
    source: `const select = () => { const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null; return groups; };`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "deferred receiver transport",
    source: `const groups = new Map(); const transport = () => consume(groups); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "forEach third map argument",
    source: `const groups = new Map(); groups.forEach((value, key, sameMap) => sameMap.get = customGet); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "forEach rest map carrier",
    source: `const groups = new Map(); groups.forEach((...values) => consume(values)); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "forEach default parameter",
    source: `const groups = new Map(); groups.forEach((value = mutate()) => {}); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "forEach function arguments carrier",
    source: `const groups = new Map(); groups.forEach(function() { consume(arguments); }); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "Map prototype replacement",
    source: `Map.prototype.get = customGet; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "Map constructor assignment",
    source: `Map = CustomMap; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "Map provider escape",
    source: `consume(Map); const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "global provider projection",
    source: `globalThis.Map.prototype.get = customGet; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "unknown global projection",
    source: `globalThis[providerName] = CustomMap; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "global provider destructure",
    source: `const { Map: Provider } = globalThis; Provider.prototype.get = customGet; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "Array converter replacement",
    source: `Array.from = consume; const groups = new Map(); const entries = Array.from(groups); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "converter alias transport",
    source: `const groups = new Map(); const convert = Array.from; const entries = convert(groups); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "shadowed constructor inherited quiet",
    source: `const Map = createProvider(); const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "imported constructor inherited quiet",
    source: `import Map from 'custom-map'; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;`,
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "deferred third Map argument retains warning",
    source:
      "const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null; groups.forEach((value, key, sameMap) => sameMap.get = customGet);",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "deferred rest carrier retains warning",
    source:
      "const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null; groups.forEach((...values) => consume(values));",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "deferred converter replacement retains warning",
    source:
      "const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null; Array.from = consume; const entries = Array.from(groups);",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "native converter mapping callback unsupported",
    source:
      "const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null; const entries = Array.from(groups, consume);",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "prototype reflection transport inherits abstention",
    source:
      "const groups = new Map(); Object.getPrototypeOf(groups).get = customGet; const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 0,
    proofExpected: 0,
  },
  {
    name: "deferred prototype reflection retains warning",
    source:
      "const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null; Object.getPrototypeOf(groups).get = customGet;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "nested global self provider replacement",
    source:
      "globalThis.globalThis.Map.prototype.get = customGet; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "global self provider alias",
    source:
      "const realm = globalThis; realm.Map.prototype.get = customGet; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "readonly provider method escape",
    source:
      "const get = Map.prototype.get; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "computed provider replacement",
    source:
      "const method = 'get'; Map.prototype[method] = customGet; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "instance constructor projection",
    source:
      "const groups = new Map(); const Constructor = groups.constructor; const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "regex key produces distinct objects",
    source:
      "const groups = new Map(); const selected = groups.get(/group/) ? groups.get(/group/)!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "bigint literal deferred",
    source:
      "const groups = new Map(); const selected = groups.get(1n) ? groups.get(1n)!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "mutable receiver",
    source:
      "let groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "optional guard call deferred",
    source:
      "const groups = new Map(); const selected = groups.get?.('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "third argument after empty parameter default deferred",
    source:
      "const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null; groups.forEach((value = {}) => {});",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "global eval provider replacement",
    source:
      "eval('Map.prototype.get = customGet'); const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "global Function provider replacement",
    source:
      "Function('Map.prototype.get = customGet')(); const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "global Function exposure",
    source:
      "const create = Function; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "shadowed Function is ordinary local data",
    source:
      "const Function = 1; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "type-only Function reference",
    source:
      "type Function = () => void; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "type-only global eval query",
    source:
      "type Evaluator = typeof eval; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 0,
    proofExpected: 1,
  },
  {
    name: "callable constructor provider replacement",
    source:
      "const compile = (() => {}).constructor; compile('Map.prototype.get = customGet')(); const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "destructured callable constructor provider replacement",
    source:
      "const { constructor: compile } = () => {}; compile('Map.prototype.get = customGet')(); const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 1,
    proofExpected: 0,
  },
  {
    name: "type-only constructor shape",
    source:
      "type Factory = { constructor: () => void }; const groups = new Map(); const selected = groups.get('group') ? groups.get('group')!.value : null;",
    expected: 0,
    proofExpected: 1,
  },
];

const guardedMapProofRule = {
  ...noNonNullAssertionOnMaybeUndefinedResult,
  create: (context: RuleContext) => ({
    TSNonNullExpression: (node: EsTreeNode) => {
      if (isImmediatelyGuardedMapGet(node, context))
        context.report({ node, message: "Proved immediate guarded Map get" });
    },
  }),
};

describe("immediate guarded local Map get", () => {
  for (const { name, source, expected, proofExpected } of guardedMapCases) {
    it(name, () => {
      const result = runRule(noNonNullAssertionOnMaybeUndefinedResult, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
      const proofResult = runRule(guardedMapProofRule, source);
      expect(proofResult.parseErrors).toEqual([]);
      expect(proofResult.diagnostics).toHaveLength(proofExpected);
    });
  }
});
