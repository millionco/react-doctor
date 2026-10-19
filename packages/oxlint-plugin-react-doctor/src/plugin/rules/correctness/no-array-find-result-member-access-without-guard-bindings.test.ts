import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

const cases = [
  {
    name: "probe-nominal",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 1,
  },
  {
    name: "probe-erased-array-interface",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\ninterface ITEMS {}\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 1,
  },
  {
    name: "probe-erased-array-type-alias",
    code: 'const ITEMS = [{ name: "first", enabled: false }];\ntype ITEMS = unknown;\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 1,
  },
  {
    name: "probe-global-Function-provider",
    code: 'Function("Array.prototype.find = () => ({ name: \'custom\' })")();\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 0,
  },
  {
    name: "probe-erased-Function-interface-provider",
    code: 'interface Function {}\nFunction("Array.prototype.find = () => ({ name: \'custom\' })")();\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 0,
  },
  {
    name: "probe-erased-Function-type-provider",
    code: 'type Function = unknown;\nFunction("Array.prototype.find = () => ({ name: \'custom\' })")();\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 0,
  },
  {
    name: "probe-runtime-Function-companion",
    code: 'const Function = () => {};\ninterface Function {}\nFunction();\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 1,
  },
  {
    name: "probe-erased-array-runtime-shadow",
    code: 'const ITEMS = { find: () => ({ name: "custom" }) };\ninterface ITEMS {}\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 0,
  },
  {
    name: "type-only-provider-destructure",
    code: 'type Callback = ({ prototype }: { prototype: unknown }) => void;\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 1,
  },
  {
    name: "type-only-wrapper-control",
    code: 'type Callback = (value: unknown) => void;\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 1,
  },
  {
    name: "runtime-provider-destructure",
    code: 'const provider = { prototype: null };\nconst { prototype } = provider;\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 0,
  },
  {
    name: "runtime-parameter-property-provider",
    code: 'class Setup { constructor(public value = Function("Array.prototype.find = () => ({ name: \'custom\' })")()) {} }\nnew Setup();\nconst ITEMS = [{ name: "first", enabled: false }];\nexport const read = () => ITEMS.find((item) => item.enabled).name;\n',
    expected: 0,
  },
];

describe("uppercase array runtime bindings", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noArrayFindResultMemberAccessWithoutGuard, testCase.code, {
        filename: "synthetic-uppercase-array-bindings.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});
