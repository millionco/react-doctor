import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";
interface ConstructorExposureCase {
  name: string;
  code: string;
  expectedCount: number;
}
const cases: ConstructorExposureCase[] = [
  {
    name: "direct constructor",
    code: '(()=>{}).constructor("global = {}")();global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 1,
  },
  {
    name: "computed constructor",
    code: 'const propertyName="constructor";(()=>{})[propertyName]("global = {}")();global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 1,
  },
  {
    name: "destructured constructor",
    code: 'const {constructor:execute}=()=>{};execute("global = {}")();global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 1,
  },
  {
    name: "computed destructured constructor",
    code: 'const propertyName="constructor";const {[propertyName]:execute}=()=>{};execute("global = {}")();global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 1,
  },
  {
    name: "constructor alias",
    code: 'const execute=(()=>{}).constructor;execute("global = {}")();global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 1,
  },
  {
    name: "unrelated computed member",
    code: 'const propertyName="label";const record={label:"ready"};void record[propertyName];global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 0,
  },
  {
    name: "unrelated computed pattern",
    code: 'const propertyName="label";const {[propertyName]:label}={label:"ready"};void label;global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expectedCount: 0,
  },
];
describe("structuredClone constructor escapes", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noJsonParseStringifyClone, code, {
      filename: "src/constructor-exposure.tsx",
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
