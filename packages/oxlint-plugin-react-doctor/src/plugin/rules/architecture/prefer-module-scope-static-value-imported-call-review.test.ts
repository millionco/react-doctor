import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

const cases = [
  {
    name: "baseline-imported-evaluation",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    expected: 0,
  },
  {
    name: "merged-imported-reader-interface",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\ninterface readSnapshot {}\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    expected: 0,
  },
  {
    name: "merged-readonly-reader-alias-interface",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\ninterface selectedReader {}\nconst selectedReader = readSnapshot;\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: selectedReader() };\n  return { options, enabled };\n};\n',
    expected: 0,
  },
  {
    name: "merged-intermediate-reader-alias-interface",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\ninterface firstReader {}\nconst firstReader = readSnapshot;\nconst selectedReader = firstReader;\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: selectedReader() };\n  return { options, enabled };\n};\n',
    expected: 0,
  },
  {
    name: "genuine-local-reader-with-interface",
    code: 'import { useState } from "react";\nconst readSnapshot = () => "fixed";\ninterface readSnapshot {}\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    expected: 1,
  },
  {
    name: "ordinary-local-reader-control",
    code: 'import { useState } from "react";\nconst readSnapshot = () => "fixed";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    expected: 1,
  },
  {
    name: "type-only-reader-import-control",
    code: 'import { useState } from "react";\nimport type readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    expected: 1,
  },
  {
    name: "static-object-activation",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: "fixed" };\n  return { options, enabled };\n};\n',
    expected: 1,
  },
  {
    name: "plain-const-alias-write",
    code: 'import readSnapshot from "./state-reader";\nconst selectedReader = readSnapshot;\nselectedReader = () => "replacement";\nexport const useSettings = () => {\n  const options = { label: selectedReader() };\n  return options;\n};\n',
    expected: 1,
  },
  {
    name: "destructured-const-alias-write",
    code: 'import readSnapshot from "./state-reader";\nconst selectedReader = readSnapshot;\n({ selectedReader } = { selectedReader: () => "replacement" });\nexport const useSettings = () => {\n  const options = { label: selectedReader() };\n  return options;\n};\n',
    expected: 1,
  },
  {
    name: "readonly-const-alias",
    code: 'import readSnapshot from "./state-reader";\nconst selectedReader = readSnapshot;\n\nexport const useSettings = () => {\n  const options = { label: selectedReader() };\n  return options;\n};\n',
    expected: 0,
  },
  {
    name: "destructuring-rhs-readonly-alias",
    code: 'import readSnapshot from "./state-reader";\nconst selectedReader = readSnapshot;\n\nconst holder: {reader?: unknown} = {};\n({reader: holder.reader} = {reader: selectedReader});\nexport const useSettings = () => {\n  const options = { label: selectedReader() };\n  return options;\n};\n',
    expected: 0,
  },
  {
    name: "destructuring-computed-key-readonly-alias",
    code: 'import readSnapshot from "./state-reader";\nconst selectedReader = readSnapshot;\n\nlet ignored: unknown;\n({[selectedReader.name]: ignored} = {});\nexport const useSettings = () => {\n  const options = { label: selectedReader() };\n  return options;\n};\n',
    expected: 0,
  },
];

describe("imported call runtime binding and mutation boundaries", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(preferModuleScopeStaticValue, testCase.code, {
        filename: "src/imported-call-review.tsx",
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
    });
  }
});
