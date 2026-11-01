import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoFalsyAndRender } from "./rn-no-falsy-and-render.js";
const source =
  'import { forwardRef } from "react";\nimport { View, Text } from "react-native";\ninterface CardProps { rate?: string; }\nexport const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {\n  return <View>{rate && <Text>Rated</Text>}</View>;\n});\n';
describe("explicit native string provider identity", () => {
  it.each([
    {
      prefix:
        'const propertyName="constructor"; interface propertyName {} (()=>{})[propertyName]("globalThis.require(\'react\').forwardRef = render => render({rate:0}, null)")();',
      expected: 1,
    },
    {
      prefix:
        "const propertyName=`constructor`; type propertyName=unknown; const {[propertyName]:factory}=(()=>{}); factory(\"globalThis.require('react').forwardRef = render => render({rate:0}, null)\")();",
      expected: 1,
    },
    {
      prefix: 'const propertyName="length"; interface propertyName {} void (()=>{})[propertyName];',
      expected: 0,
    },
    {
      prefix:
        "const propertyName=`constructor`; (()=>{})[propertyName](\"globalThis.require('react').forwardRef = render => render({rate:0}, null)\")();",
      expected: 1,
    },
    {
      prefix:
        "const propertyName=`constructor`; const {[propertyName]:factory}=(()=>{}); factory(\"globalThis.require('react').forwardRef = render => render({rate:0}, null)\")();",
      expected: 1,
    },
    { prefix: "const propertyName=`length`; void (()=>{})[propertyName];", expected: 0 },
    {
      prefix:
        'const propertyName="constructor"; (()=>{})[propertyName]("globalThis.require(\'react\').forwardRef = render => render({rate:0}, null)")();',
      expected: 1,
    },
    {
      prefix:
        'const propertyName="constructor"; const {[propertyName]:factory}=(()=>{}); factory("globalThis.require(\'react\').forwardRef = render => render({rate:0}, null)")();',
      expected: 1,
    },
    { prefix: 'const propertyName="length"; void (()=>{})[propertyName];', expected: 0 },
    { prefix: "require('react').forwardRef = render => render({rate:0}, null);", expected: 1 },
    {
      prefix: "globalThis.require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "declare const require:any; require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "interface require {} require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "type require=unknown; require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "import type require from \"loader\"; require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "import {type require} from \"loader\"; require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "declare const globalThis:any; globalThis.require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "declare const module:any; module.require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "const world=globalThis; world.require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        "declare const globalThis:any; const world=globalThis; world.require('react').forwardRef = render => render({rate:0}, null);",
      expected: 1,
    },
    {
      prefix:
        'import {createRequire} from "node:module"; const load=createRequire(import.meta.url); load("react").forwardRef=replacement;',
      expected: 1,
    },
    { prefix: 'void import("react");', expected: 1 },
    { prefix: 'Function("mutate")();', expected: 1 },
    { prefix: 'declare const Function:any; Function("mutate")();', expected: 1 },
    { prefix: '(()=>{}).constructor("mutate")();', expected: 1 },
    { prefix: "", expected: 0 },
    { prefix: "declare const require:unknown;", expected: 0 },
    { prefix: "interface require {}", expected: 0 },
    { prefix: 'import type require from "loader";', expected: 0 },
    {
      prefix:
        "const require = () => ({ forwardRef: 0 }); require('react').forwardRef = render => render({rate:0}, null);",
      expected: 0,
    },
    {
      prefix:
        "const require = () => ({ forwardRef: 0 }); interface require {} require('react').forwardRef = render => render({rate:0}, null);",
      expected: 0,
    },
    {
      prefix:
        "interface require {} const require = () => ({ forwardRef: 0 }); require('react').forwardRef = render => render({rate:0}, null);",
      expected: 0,
    },
    {
      prefix:
        "const require = () => ({ forwardRef: 0 }); const localLoader=()=>{ interface require {} require('react').forwardRef = render => render({rate:0}, null); };",
      expected: 0,
    },
    {
      prefix:
        "declare const globalThis:any; typeof globalThis; void globalThis; globalThis.unrelated;",
      expected: 0,
    },
    { prefix: "globalThis.unrelated;", expected: 0 },
    { prefix: 'import type {createRequire} from "node:module";', expected: 0 },
    { prefix: 'import {type createRequire} from "node:module";', expected: 0 },
  ])("retains provider boundary: $prefix", ({ prefix, expected }) => {
    const result = runRule(rnNoFalsyAndRender, prefix + "\n" + source, {
      filename: "src/explicit-string-native-prop.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated" } },
      forceJsx: false,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
