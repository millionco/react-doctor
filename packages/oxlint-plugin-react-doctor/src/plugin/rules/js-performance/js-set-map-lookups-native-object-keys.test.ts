import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

const cases = [
  {
    name: "outer-row-native-keys-inner-fixed-queries",
    code: 'export const select=rows=>rows.every(row=>Object.keys(row).length===2 && ["left","right"].every(key=>Object.keys(row).includes(key)));\n',
    options: {
      filename: "/synthetic/native-object-keys/outer-row-native-keys-inner-fixed-queries.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "outer-for-of-binding",
    code: 'export const select=rows=>{for(const row of rows){if(["left","right"].every(key=>Object.keys(row).includes(key)))return row;}};\n',
    options: {
      filename: "/synthetic/native-object-keys/outer-for-of-binding.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "outer-row-amid-inner-unrelated-binding",
    code: 'export const select=rows=>rows.map(row=>["left","right"].map(key=>Object.keys(row).includes(key)));\n',
    options: {
      filename: "/synthetic/native-object-keys/outer-row-amid-inner-unrelated-binding.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "stable-shared-receiver-not-row",
    code: "export const select=(rows,shared)=>rows.map(row=>Object.keys(shared).includes(row.name));\n",
    options: {
      filename: "/synthetic/native-object-keys/stable-shared-receiver-not-row.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "unknown-call-ignores-row",
    code: 'const shared=["a","b","c","d","e","f","g","h","i"];const getShared=row=>shared;export const select=rows=>rows.map(row=>getShared(row).includes(row.name));\n',
    options: {
      filename: "/synthetic/native-object-keys/unknown-call-ignores-row.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "foreign-imported-key-factory",
    code: 'import makeKeys from "example-keys";export const select=rows=>rows.map(row=>makeKeys(row).includes(row.name));\n',
    options: {
      filename: "/synthetic/native-object-keys/foreign-imported-key-factory.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "shadowed-Object-can-return-shared",
    code: "export const select=(rows,Object)=>rows.map(row=>Object.keys(row).includes(row.name));\n",
    options: {
      filename: "/synthetic/native-object-keys/shadowed-Object-can-return-shared.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "visible-keys-replacement",
    code: 'const shared=["a","b","c","d","e","f","g","h","i"];Object.keys=()=>shared;export const select=rows=>rows.map(row=>Object.keys(row).includes(row.name));\n',
    options: {
      filename: "/synthetic/native-object-keys/visible-keys-replacement.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "Object-alias-transport",
    code: "const Native=Object;export const select=rows=>rows.map(row=>Native.keys(row).includes(row.name));\n",
    options: {
      filename: "/synthetic/native-object-keys/Object-alias-transport.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "keys-function-alias",
    code: "const keys=Object.keys;export const select=rows=>rows.map(row=>keys(row).includes(row.name));\n",
    options: {
      filename: "/synthetic/native-object-keys/keys-function-alias.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "computed-keys-call",
    code: 'export const select=rows=>rows.map(row=>Object["keys"](row).includes(row.name));\n',
    options: {
      filename: "/synthetic/native-object-keys/computed-keys-call.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "spread-native-call-arguments",
    code: "export const select=rows=>rows.map(row=>Object.keys(...row).includes(row.name));\n",
    options: {
      filename: "/synthetic/native-object-keys/spread-native-call-arguments.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "inner-shadow-is-not-outer-binding",
    code: 'export const select=rows=>rows.map(row=>{const read=(row)=>Object.keys(row).includes("left");return read(shared);});\n',
    options: {
      filename: "/synthetic/native-object-keys/inner-shadow-is-not-outer-binding.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "global-carrier-replacement",
    code: "globalThis.Object.keys=()=>shared;export const select=rows=>rows.map(row=>Object.keys(row).includes(row.name));\n",
    options: {
      filename: "/synthetic/native-object-keys/global-carrier-replacement.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "stable-large-array-positive",
    code: "export const select=(rows,allowed)=>rows.map(row=>allowed.includes(row.name));\n",
    options: {
      filename: "/synthetic/native-object-keys/stable-large-array-positive.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "already-per-iteration-member-receiver",
    code: "export const select=rows=>rows.map(row=>row.allowed.includes(row.name));\n",
    options: {
      filename: "/synthetic/native-object-keys/already-per-iteration-member-receiver.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "readonly-global-carrier-replacement",
    code: 'const root = globalThis; root.Object.keys = () => shared; export const select = rows => rows.map(row => ["first", "second"].every(query => Object.keys(row).includes(query)));\n',
    options: {
      filename: "/synthetic/native-object-keys/readonly-global-carrier-replacement.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "resolved-computed-keys-replacement",
    code: 'const property = "keys"; Object[property] = () => shared; export const select = rows => rows.map(row => ["first", "second"].every(query => Object.keys(row).includes(query)));\n',
    options: {
      filename: "/synthetic/native-object-keys/resolved-computed-keys-replacement.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "namespace-value-escape",
    code: 'observe(Object); export const select = rows => rows.map(row => ["first", "second"].every(query => Object.keys(row).includes(query)));\n',
    options: {
      filename: "/synthetic/native-object-keys/namespace-value-escape.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "outer-element-binding-reassigned",
    code: 'export const select = (rows, shared) => rows.map(row => { row = shared; return ["first", "second"].every(query => Object.keys(row).includes(query)); });\n',
    options: {
      filename: "/synthetic/native-object-keys/outer-element-binding-reassigned.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "callback-local-shadow-of-outer-binding",
    code: 'export const select = (rows, shared) => rows.map(row => { const read = row => ["first", "second"].every(query => Object.keys(row).includes(query)); return read(shared); });\n',
    options: {
      filename: "/synthetic/native-object-keys/callback-local-shadow-of-outer-binding.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "deferred-callback-not-loop-region",
    code: 'export const makeReads = rows => { const reads = []; for (const row of rows) { reads.push(() => Object.keys(row).includes("first")); } return reads; };\n',
    options: {
      filename: "/synthetic/native-object-keys/deferred-callback-not-loop-region.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "ordinary-inner-static-queries",
    code: 'export const select = rows => Array.isArray(rows) && rows.every(row => ["first", "second"].every(query => Object.keys(row).includes(query)));\n',
    options: {
      filename: "/synthetic/native-object-keys/ordinary-inner-static-queries.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "readonly-outer-binding-through-transparent-assertion",
    code: 'export const select = rows => rows.every(row => ["first", "second"].every(query => Object.keys((row as object)).includes(query)));\n',
    options: {
      filename:
        "/synthetic/native-object-keys/readonly-outer-binding-through-transparent-assertion.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "native-indexof-membership",
    code: 'export const select=rows=>rows.every(row=>Object.keys(row).indexOf("field")!==-1);\n',
    options: {
      filename: "/synthetic/native-object-keys/native-indexof-membership.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "runtime-value-Object-import",
    code: 'import Object from "synthetic-native-provider";export const select=rows=>rows.every(row=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/runtime-value-Object-import.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "optional-native-keys-call",
    code: 'export const select=rows=>rows.every(row=>Object.keys?.(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/optional-native-keys-call.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "extra-native-keys-argument",
    code: 'export const select=rows=>rows.every(row=>Object.keys(row, shared).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/extra-native-keys-argument.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "named-iteration-callback",
    code: 'export const select=rows=>rows.every(function inspect(row){return Object.keys(row).includes("field");});\n',
    options: {
      filename: "/synthetic/native-object-keys/named-iteration-callback.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "async-iteration-callback",
    code: 'export const select=rows=>rows.every(async row=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/async-iteration-callback.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "readonly-element-argument-alias",
    code: 'export const select=rows=>rows.every(row=>{const alias=row;return Object.keys(alias).includes("field");});\n',
    options: {
      filename: "/synthetic/native-object-keys/readonly-element-argument-alias.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "resolved-constructor-reflection",
    code: 'const property="constructor";const build=(()=>{})[property];void build;export const select=rows=>rows.every(row=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/resolved-constructor-reflection.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "native-namespace-destructuring",
    code: 'const {keys}=Object;void keys;export const select=rows=>rows.every(row=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/native-namespace-destructuring.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "visible-iteration-method-replacement",
    code: 'export const select=(rows,shared)=>{rows.every=callback=>callback(shared);return rows.every(row=>Object.keys(row).includes("field"));};\n',
    options: {
      filename: "/synthetic/native-object-keys/visible-iteration-method-replacement.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "known-local-custom-iteration-receiver",
    code: 'const rows={every:callback=>callback(shared)};export const select=()=>rows.every(row=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/known-local-custom-iteration-receiver.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "benign-other-direct-native-keys",
    code: "const columns=Object.keys({first:1,second:2});export const select=rows=>rows.every(row=>Object.keys(row).includes(columns[0]));\n",
    options: {
      filename: "/synthetic/native-object-keys/benign-other-direct-native-keys.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "erased-selected-input-collision",
    code: 'export const select=rows=>rows.every(row=>{function inspect(){interface row{};return row;}void inspect;return Object.keys(row).includes("field");});\n',
    options: {
      filename: "/synthetic/native-object-keys/erased-selected-input-collision.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "type-only-Object-import",
    code: 'import type Object from "synthetic-native-provider";export const select=rows=>rows.every(row=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/type-only-Object-import.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "reflective-native-keys-write",
    code: 'Reflect.defineProperty(Object,"keys",{value:()=>shared});export const select=rows=>rows.every(row=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/reflective-native-keys-write.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "ambient-declaration-channel",
    code: 'declare const eval:(text:string)=>unknown;export const select=rows=>rows.every(row=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/ambient-declaration-channel.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "awaited-for-of-iteration",
    code: 'export const select=async rows=>{for await(const row of rows){if(Object.keys(row).includes("field"))return row;}};\n',
    options: {
      filename: "/synthetic/native-object-keys/awaited-for-of-iteration.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "defaulted-first-element-parameter",
    code: 'export const select=rows=>rows.every((row=shared)=>Object.keys(row).includes("field"));\n',
    options: {
      filename: "/synthetic/native-object-keys/defaulted-first-element-parameter.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "computed-conditional-constructor-carrier",
    code: 'const selector = true ? "constructor" : "constructor";\nconst carrier = ({})[selector];\nconst shared = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];\ncarrier.keys = () => shared;\nexport const select = rows => rows.map(row => ["first", "second"].every(query => Object.keys(row).includes(query)));\n',
    options: {
      filename: "/synthetic/native-object-keys/computed-conditional-constructor-carrier.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "computed-object-pattern-constructor-carrier",
    code: 'const property = false ? "constructor" : "constructor";\nconst { [property]: namespace } = {};\nconst shared = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"];\nnamespace.keys = () => shared;\nexport const select = rows => rows.every(row => ["primary", "secondary"].every(query => Object.keys(row).includes(query)));\n',
    options: {
      filename: "/synthetic/native-object-keys/computed-object-pattern-constructor-carrier.ts",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
];

describe("native Object.keys outer iteration receiver", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(jsSetMapLookups, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
