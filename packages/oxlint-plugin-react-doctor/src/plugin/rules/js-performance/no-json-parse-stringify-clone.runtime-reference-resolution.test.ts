import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";

const scenarios = [
  {
    name: "interface after constructor key",
    code: 'const propertyName="constructor";interface propertyName{};(()=>{})[propertyName]("global = {}")();global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expected: 1,
  },
  {
    name: "interface before constructor key",
    code: 'interface propertyName{};const propertyName="constructor";(()=>{})[propertyName]("global = {}")();global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expected: 1,
  },
  {
    name: "type alias after template constructor key",
    code: 'const propertyName=`constructor`;type propertyName=unknown;const {[propertyName]:execute}=()=>{};execute("global = {}")();global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expected: 1,
  },
  {
    name: "inert computed key beside interface",
    code: 'const propertyName="length";interface propertyName{};void (()=>{})[propertyName];global.structuredClone = value => JSON.parse(JSON.stringify(value));',
    expected: 0,
  },
];

describe("constructor keys beside erased types", () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = runRule(noJsonParseStringifyClone, scenario.code, {
        filename: "src/constructor-key.tsx",
        forceJsx: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(scenario.expected);
    });
  }
});
