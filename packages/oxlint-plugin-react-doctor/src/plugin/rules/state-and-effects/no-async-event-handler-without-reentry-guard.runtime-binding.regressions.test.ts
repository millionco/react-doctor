import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

const componentSource =
  '// rule: no-async-event-handler-without-reentry-guard\n// weakness: state-control-guard\n// verdict: pass\nimport { useState } from "react";\nexport const ActionButton = () => {\n  const [isDisabling, setIsDisabling] = useState(false);\n  const action = async () => {\n    setIsDisabling(true);\n    try {\n      await fetch("/api/work", { method: "POST" });\n    } catch {\n      setIsDisabling(false);\n    }\n  };\n  return (\n    <button disabled={isDisabling} onClick={action}>\n      Run\n    </button>\n  );\n};\n';

const source = componentSource;
const options = {
  filename: "/project/src/view.tsx",
  forceJsx: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      rootDirectory: "/project",
      framework: "vite",
      capabilities: ["react"],
    },
    react: { version: "19.0.0" },
  },
};

describe("no-async-event-handler-without-reentry-guard runtime provider bindings", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    { name: "direct", prefix: "require('react').useState = () => [false, () => {}];", expected: 1 },
    {
      name: "type-import-equals",
      prefix:
        "import type require = require('provider-types'); require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
    {
      name: "local",
      prefix:
        "const require = (_source: string) => ({useState: () => [false, () => {}]}); require('react').useState = () => [false, () => {}];",
      expected: 0,
    },
    {
      name: "local-interface",
      prefix:
        "const require = (_source: string) => ({useState: () => [false, () => {}]}); interface require {} require('react').useState = () => [false, () => {}];",
      expected: 0,
    },
    {
      name: "interface-local",
      prefix:
        "interface require {} const require = (_source: string) => ({useState: () => [false, () => {}]}); require('react').useState = () => [false, () => {}];",
      expected: 0,
    },
    {
      name: "outer-local-inner-interface",
      prefix:
        "const require = (_source: string) => ({useState: () => [false, () => {}]}); function localLoader() { interface require {} require('react').useState = () => [false, () => {}]; }",
      expected: 0,
    },
    {
      name: "value-import-equals",
      prefix:
        "import require = require('provider-types'); require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
  ])("preserves runtime binding: $name", ({ prefix, expected }) => {
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
