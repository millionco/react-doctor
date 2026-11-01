import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

const source =
  '// verdict: pass\n// rule: no-reset-all-state-on-prop-change\n// weakness: binding-identity\n// source: independent synthetic partial-state reset\nimport { useEffect, useState } from "react";\nexport const Example = ({ itemKey }: { itemKey: string }) => {\n  const [notice, writeNotice] = useState("");\n  const [, writeBusy] = useState(false);\n  const [previousKey] = useState(itemKey);\n\n  useEffect(() => {\n    writeNotice("");\n    writeBusy(false);\n  }, [itemKey]);\n  return (\n    <section>\n      <button onClick={() => writeNotice("changed")}>Change</button>\n      <button onClick={() => writeBusy(true)}>Busy</button>\n      <output>\n        {notice}:{previousKey}\n      </output>\n    </section>\n  );\n};\n';
const options = {
  filename: "/project/src/view.tsx",
  forceJsx: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      rootDirectory: "/project",
      framework: "vite",
      capabilities: ["react", "nextjs", "r3f", "react-native"],
    },
    react: { version: "19.0.0" },
  },
};

describe("no-reset-all-state-on-prop-change runtime provider bindings", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    { name: "direct", prefix: "require('react').useState = () => [0, () => {}];", expected: 1 },
    {
      name: "type-import-equals",
      prefix:
        "import type require = require('provider-types'); require('react').useState = () => [0, () => {}];",
      expected: 1,
    },
    {
      name: "local",
      prefix:
        "const require = (_source: string) => ({useState: () => [0, () => {}]}); require('react').useState = () => [0, () => {}];",
      expected: 0,
    },
    {
      name: "local-interface",
      prefix:
        "const require = (_source: string) => ({useState: () => [0, () => {}]}); interface require {} require('react').useState = () => [0, () => {}];",
      expected: 0,
    },
    {
      name: "interface-local",
      prefix:
        "interface require {} const require = (_source: string) => ({useState: () => [0, () => {}]}); require('react').useState = () => [0, () => {}];",
      expected: 0,
    },
    {
      name: "outer-local-inner-interface",
      prefix:
        "const require = (_source: string) => ({useState: () => [0, () => {}]}); function localLoader() { interface require {} require('react').useState = () => [0, () => {}]; }",
      expected: 0,
    },
    {
      name: "value-import-equals",
      prefix:
        "import require = require('provider-types'); require('react').useState = () => [0, () => {}];",
      expected: 1,
    },
  ])("preserves runtime binding: $name", ({ prefix, expected }) => {
    const result = runRule(noResetAllStateOnPropChange, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
