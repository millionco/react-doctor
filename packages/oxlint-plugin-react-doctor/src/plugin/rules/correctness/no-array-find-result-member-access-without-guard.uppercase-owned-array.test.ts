import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

const cases = [
  {
    name: "uppercase-array-missing-element",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [
        {
          column: 26,
          line: 2,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "pascal-array-find-last",
    code: 'const Items = [{ name: "first", enabled: false }];\nexport const read = () => Items.findLast((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [
        {
          column: 26,
          line: 2,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "optional-member-remains-guarded",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled)?.name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unknown-capitalized-model",
    code: "export const read = (Model, query) => Model.find(query).lean();\n",
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "capitalized-object-provider",
    code: 'const Items = { find: () => ({ name: "result" }) };\nexport const read = () => Items.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "receiver-method-override",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\nITEMS.find = () => ({ name: "custom" });\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "opaque-array-escape",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\nconfigure(ITEMS);\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "array-alias-escape",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\nconst alias = ITEMS;\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "implicit-third-callback-array",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\nITEMS.find((item, index, array) => { array.find = () => ({ name: "custom" }); return false; });\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "function-callback-arguments",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\nITEMS.find(function (item) { configure(arguments[2]); return false; });\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "exported-receiver",
    code: 'export const ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "global-array-find-override",
    code: 'Array.prototype.find = () => ({ name: "custom" });\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "reassignable-array-binding",
    code: 'let ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "reflection-destructure-override",
    code: 'const { defineProperty: replace } = Object;\nreplace(Array.prototype, "find", { value: () => ({ name: "custom" }) });\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "existing-lowercase-unsafe-array",
    code: 'const items = [{ name: "first", enabled: false }];\nexport const read = () => items.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [
        {
          column: 26,
          line: 2,
          message:
            "`find` returns `undefined` when nothing matches, so reading from its result here throws `Cannot read properties of undefined` — use optional chaining (`?.`) or guard the result before you use it.",
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "runtime-enum-array-escape",
    code: 'const ITEMS: any = [{ name: "first", enabled: false }];\nexport enum Leak { Value = ITEMS }\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    options: {
      filename: "synthetic-uppercase-owned-array-find.tsx",
      includeLocations: true,
    },
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
];

describe("closed uppercase native array find receivers", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        runRule(noArrayFindResultMemberAccessWithoutGuard, testCase.code, testCase.options),
      ).toEqual(testCase.expectedResult);
    });
  }
});
