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

describe("no-reset-all-state-on-prop-change erased namespace providers", () => {
  it.each([
    { name: "direct", prefix: "require('react').useState = () => [0, () => {}];", expected: 1 },
    {
      name: "empty",
      prefix: "namespace require {} require('react').useState = () => [0, () => {}];",
      expected: 1,
    },
    {
      name: "type-only",
      prefix:
        "namespace require { export interface Marker {} } require('react').useState = () => [0, () => {}];",
      expected: 1,
    },
    {
      name: "nested",
      prefix:
        "namespace require { export namespace Inner { export type Marker = unknown; } } require('react').useState = () => [0, () => {}];",
      expected: 1,
    },
    {
      name: "runtime",
      prefix:
        "namespace require { export const marker = 0; } require('react').useState = () => [0, () => {}];",
      expected: 1,
    },
  ])("preserves emitted binding: $name", ({ prefix, expected }) => {
    const result = runRule(noResetAllStateOnPropChange, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
