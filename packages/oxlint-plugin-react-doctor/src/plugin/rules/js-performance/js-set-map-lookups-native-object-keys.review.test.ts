import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

const cases = [
  {
    name: "baseline-native-outer-input",
    code: 'export const select=rows=>rows.every(row=>["left","right"].every(key=>Object.keys(row).includes(key)));\n',
    expected: 0,
  },
  {
    name: "stable-collection-activation",
    code: "export const select=(rows,allowed)=>rows.every(row=>allowed.includes(row.name));\n",
    expected: 1,
  },
  {
    name: "merged-global-object-interface",
    code: 'interface Object {}\nexport const select=rows=>rows.every(row=>["left","right"].every(key=>Object.keys(row).includes(key)));\n',
    expected: 0,
  },
  {
    name: "erased-global-object-type-alias",
    code: 'type Object = {};\nexport const select=rows=>rows.every(row=>["left","right"].every(key=>Object.keys(row).includes(key)));\n',
    expected: 0,
  },
  {
    name: "inner-row-interface",
    code: 'export const select=rows=>rows.every(row=>{interface row {} return ["left","right"].every(key=>Object.keys(row).includes(key));});\n',
    expected: 0,
  },
  {
    name: "type-only-object-import",
    code: 'import type { Object } from "types-only";\nexport const select=rows=>rows.every(row=>["left","right"].every(key=>Object.keys(row).includes(key)));\n',
    expected: 0,
  },
  {
    name: "genuine-local-object",
    code: 'const stableKeys=["left","right"];const Object={keys:()=>stableKeys};\nexport const select=rows=>rows.every(row=>["left","right"].every(key=>Object.keys(row).includes(key)));\n',
    expected: 1,
  },
  {
    name: "genuine-local-object-interface",
    code: 'interface Object {}\nconst stableKeys=["left","right"];const Object={keys:()=>stableKeys};\nexport const select=rows=>rows.every(row=>["left","right"].every(key=>Object.keys(row).includes(key)));\n',
    expected: 1,
  },
  {
    name: "readonly-input",
    code: 'export const select=(rows,other)=>rows.every(row=>{return ["left","right"].every(key=>Object.keys(row).includes(key));});\n',
    expected: 0,
  },
  {
    name: "plain-input-write",
    code: 'export const select=(rows,other)=>rows.every(row=>{row=other;return ["left","right"].every(key=>Object.keys(row).includes(key));});\n',
    expected: 1,
  },
  {
    name: "destructured-input-write",
    code: 'export const select=(rows,other)=>rows.every(row=>{({row}=other);return ["left","right"].every(key=>Object.keys(row).includes(key));});\n',
    expected: 1,
  },
];

describe("native Object.keys iteration binding and write guards", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(jsSetMapLookups, testCase.code, {
        filename: "/synthetic/native-keys-review/lookup.ts",
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: [] } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});
