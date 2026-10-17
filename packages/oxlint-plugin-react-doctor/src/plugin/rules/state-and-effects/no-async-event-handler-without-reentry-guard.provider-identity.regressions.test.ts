import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

const componentSource =
  '// rule: no-async-event-handler-without-reentry-guard\n// weakness: state-control-guard\n// verdict: pass\nimport { useState } from "react";\nexport const ActionButton = () => {\n  const [isDisabling, setIsDisabling] = useState(false);\n  const action = async () => {\n    setIsDisabling(true);\n    try {\n      await fetch("/api/work", { method: "POST" });\n    } catch {\n      setIsDisabling(false);\n    }\n  };\n  return (\n    <button disabled={isDisabling} onClick={action}>\n      Run\n    </button>\n  );\n};\n';

describe("native disabling setter provider identity", () => {
  it.each([
    { prefix: "", expected: 0 },
    { prefix: "globalThis.require('react').useState = () => [false, () => {}];", expected: 1 },
    { prefix: "require('react').useState = () => [false, () => {}];", expected: 1 },
    {
      prefix:
        "declare const globalThis: any; globalThis.require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
    {
      prefix:
        "interface globalThis {} globalThis.require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
    {
      prefix:
        "import type globalThis from \"carrier\"; globalThis.require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
    {
      prefix: 'declare const require: any; require("react").useState = () => [false, () => {}];',
      expected: 1,
    },
    {
      prefix:
        'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("react").useState=()=>[false,()=>{}];',
      expected: 1,
    },
    {
      prefix: 'import("react").then(runtime => runtime.useState = () => [false, () => {}]);',
      expected: 1,
    },
    { prefix: "declare const globalThis: unknown;", expected: 0 },
    { prefix: "interface globalThis {}", expected: 0 },
    { prefix: 'import type globalThis from "carrier";', expected: 0 },
    {
      prefix:
        "const globalThis = { require: () => ({ useState: () => [false, () => {}] }) }; globalThis.require('react').useState = () => [false, () => {}];",
      expected: 0,
    },
    { prefix: 'import type { createRequire } from "node:module";', expected: 0 },
  ])("keeps native provider uncertainty: $prefix", ({ prefix, expected }) => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      prefix + "\n" + componentSource,
      {
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
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
