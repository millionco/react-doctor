import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";

interface RuntimeBindingCase {
  name: string;
  code: string;
  expectedCount: number;
}
const cases: RuntimeBindingCase[] = [
  {
    name: "native self definition",
    code: "global.structuredClone = value => JSON.parse(JSON.stringify(value));",
    expectedCount: 0,
  },
  {
    name: "unmasked replacement",
    code: "globalThis.structuredClone = replacement;global.structuredClone = value => JSON.parse(JSON.stringify(value));",
    expectedCount: 1,
  },
  {
    name: "ambient carrier replacement",
    code: "declare const globalThis: typeof global;globalThis.structuredClone = replacement;global.structuredClone = value => JSON.parse(JSON.stringify(value));",
    expectedCount: 1,
  },
  {
    name: "erased import equals carrier",
    code: 'import type globalThis = require("types");globalThis.structuredClone = replacement;global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 1,
  },
  {
    name: "ambient dynamic constructor",
    code: 'declare function Function(source: string): unknown; Function("global.structuredClone = replacement");global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 1,
  },
  {
    name: "genuine local dynamic constructor",
    code: "const Function = () => undefined; void Function;global.structuredClone = value => JSON.parse(JSON.stringify(value));",
    expectedCount: 0,
  },
  {
    name: "type after genuine local value",
    code: "const Function = () => undefined; interface Function {} void Function;global.structuredClone = value => JSON.parse(JSON.stringify(value));",
    expectedCount: 0,
  },
  {
    name: "type before genuine local value",
    code: "interface Function {} const Function = () => undefined; void Function;global.structuredClone = value => JSON.parse(JSON.stringify(value));",
    expectedCount: 0,
  },
  {
    name: "inner type outer local value",
    code: "const Function = () => undefined; { interface Function {} void Function;global.structuredClone = value => JSON.parse(JSON.stringify(value));}",
    expectedCount: 0,
  },
  {
    name: "erased namespace carrier remains unsupported",
    code: "namespace globalThis { export interface Carrier {} }globalThis.structuredClone = replacement;global.structuredClone = value => JSON.parse(JSON.stringify(value));",
    expectedCount: 1,
  },
];

describe("structuredClone self-definition runtime provider bindings", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noJsonParseStringifyClone, code, {
      filename: "src/runtime-provider.tsx",
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
