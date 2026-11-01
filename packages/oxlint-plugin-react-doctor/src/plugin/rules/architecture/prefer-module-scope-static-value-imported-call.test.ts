import { describe, expect, it } from "vite-plus/test";
import { runRule, type RunRuleOptions } from "../../../test-utils/run-rule.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

interface ImportedValueCallCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expectedCount: number;
}

const cases: ReadonlyArray<ImportedValueCallCase> = [
  {
    name: "imported-default-state-reader",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/imported-default-state-reader.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "imported-named-state-reader",
    code: 'import { useState } from "react";\nimport { readSnapshot } from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/imported-named-state-reader.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "renamed-reader-import",
    code: 'import { useState } from "react";\nimport { readSnapshot as selectLabel } from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: selectLabel() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/renamed-reader-import.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "nested-imported-reader-result",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { detail: { label: readSnapshot() } };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/nested-imported-reader-result.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "array-imported-reader-result",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = [readSnapshot()];\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/array-imported-reader-result.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "readonly-import-callee-alias",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nconst selectLabel = readSnapshot;\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: selectLabel() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/readonly-import-callee-alias.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "namespace-static-reader-call",
    code: 'import { useState } from "react";\nimport * as state from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: state.readSnapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/namespace-static-reader-call.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "literal-only-object",
    code: 'import { useState } from "react";\n\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: "ready" };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/literal-only-object.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "literal-only-array",
    code: 'import { useState } from "react";\n\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = ["ready", "waiting"];\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/literal-only-array.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "imported-constant-value-not-call",
    code: 'import { useState } from "react";\nimport { stableLabel } from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: stableLabel };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/imported-constant-value-not-call.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "inline-function-initializer",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { read: () => readSnapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/inline-function-initializer.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "known-date-now-call",
    code: 'import { useState } from "react";\n\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { value: Date.now() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/known-date-now-call.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "known-random-call",
    code: 'import { useState } from "react";\n\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { value: Math.random() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/known-random-call.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "literal-native-math-call",
    code: 'import { useState } from "react";\n\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { value: Math.max(1, 2) };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/literal-native-math-call.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "pure-local-name-shadow",
    code: 'import { useState } from "react";\nimport { readSnapshot as importedReader } from "./state-reader";\nconst readSnapshot = () => "fixed";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/pure-local-name-shadow.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "nested-event-allocation",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const Panel = () => { const click = () => { const options = { label: readSnapshot() }; console.log(options); }; return <button onClick={click}>Read</button>; };\n',
    options: {
      filename: "src/nested-event-allocation.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "actually-pure-import-still-conservatively-abstains",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/actually-pure-import-still-conservatively-abstains.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "imported-function-value-without-evaluation",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { read: readSnapshot };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/imported-function-value-without-evaluation.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "two-readonly-module-callee-aliases",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nconst firstReader = (readSnapshot);\nconst secondReader = firstReader;\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: secondReader() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/two-readonly-module-callee-aliases.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "type-only-import-is-not-runtime-value-evidence",
    code: 'import { useState } from "react";\nimport type readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: readSnapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/type-only-import-is-not-runtime-value-evidence.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "imported-constructor-outside-bare-call-v1",
    code: 'import { useState } from "react";\nimport Snapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { value: new Snapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/imported-constructor-outside-bare-call-v1.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "statically-dead-imported-call-conservative-policy",
    code: 'import { useState } from "react";\nimport readSnapshot from "./state-reader";\nexport const useSettings = () => {\n  const [enabled] = useState(true);\n  const options = { label: false && readSnapshot() };\n  return { options, enabled };\n};\n',
    options: {
      filename: "src/statically-dead-imported-call-conservative-policy.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "inline-type-only-specifier-is-not-value-evidence",
    code: 'import { type readSnapshot } from "./state-reader";\n\nexport const useSettings = () => {\n  const options = { label: readSnapshot() };\n  return options;\n};\n',
    options: {
      filename: "src/inline-type-only-specifier-is-not-value-evidence.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "bare-namespace-import-is-outside-call-policy",
    code: 'import * as state from "./state-reader";\n\nexport const useSettings = () => {\n  const options = { label: state() };\n  return options;\n};\n',
    options: {
      filename: "src/bare-namespace-import-is-outside-call-policy.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "module-let-callee-alias-is-not-const",
    code: 'import readSnapshot from "./state-reader";\nlet selectedReader = readSnapshot;\nexport const useSettings = () => {\n  const options = { label: selectedReader() };\n  return options;\n};\n',
    options: {
      filename: "src/module-let-callee-alias-is-not-const.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "forward-reference-alias-initializer-declines",
    code: 'import readSnapshot from "./state-reader";\nconst firstReader = secondReader;\nconst secondReader = readSnapshot;\nexport const useSettings = () => {\n  const options = { label: firstReader() };\n  return options;\n};\n',
    options: {
      filename: "src/forward-reference-alias-initializer-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "cyclic-const-aliases-decline",
    code: "\nconst firstReader = secondReader;\nconst secondReader = firstReader;\nexport const useSettings = () => {\n  const options = { label: firstReader() };\n  return options;\n};\n",
    options: {
      filename: "src/cyclic-const-aliases-decline.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "transparent-readonly-callee-aliases",
    code: 'import readSnapshot from "./state-reader";\nconst firstReader = (readSnapshot as () => string);\nconst secondReader = firstReader!;\nexport const useSettings = () => {\n  const options = { label: (secondReader)() };\n  return options;\n};\n',
    options: {
      filename: "src/transparent-readonly-callee-aliases.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "named-default-value-import",
    code: 'import { default as readSnapshot } from "./state-reader";\n\nexport const useSettings = () => {\n  const options = { label: readSnapshot() };\n  return options;\n};\n',
    options: {
      filename: "src/named-default-value-import.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "optional-imported-call-remains-outside-v1",
    code: 'import readSnapshot from "./state-reader";\n\nexport const useSettings = () => {\n  const options = { label: readSnapshot?.() };\n  return options;\n};\n',
    options: {
      filename: "src/optional-imported-call-remains-outside-v1.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "tagged-imported-call-remains-outside-v1",
    code: 'import readSnapshot from "./state-reader";\n\nexport const useSettings = () => {\n  const options = { label: readSnapshot`label` };\n  return options;\n};\n',
    options: {
      filename: "src/tagged-imported-call-remains-outside-v1.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "module-local-callee-shadow-is-not-import",
    code: 'import { readSnapshot as providerReader } from "./state-reader";\nconst readSnapshot = () => "fixed";\nexport const useSettings = () => {\n  const options = { label: readSnapshot() };\n  return options;\n};\n',
    options: {
      filename: "src/module-local-callee-shadow-is-not-import.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
  {
    name: "runtime-import-declaration-is-hoisted",
    code: '\n\nexport const useSettings = () => {\n  const options = { label: readSnapshot() };\n  return options;\n};\nimport readSnapshot from "./state-reader";\n',
    options: {
      filename: "src/runtime-import-declaration-is-hoisted.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 0,
  },
  {
    name: "const-alias-write-reference-declines",
    code: 'import readSnapshot from "./state-reader";\nconst selectedReader = readSnapshot;\nselectedReader = () => "replacement";\nexport const useSettings = () => {\n  const options = { label: selectedReader() };\n  return options;\n};\n',
    options: {
      filename: "src/const-alias-write-reference-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
    },
    expectedCount: 1,
  },
];

describe("imported value calls in static initializers", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(preferModuleScopeStaticValue, testCase.code, testCase.options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
