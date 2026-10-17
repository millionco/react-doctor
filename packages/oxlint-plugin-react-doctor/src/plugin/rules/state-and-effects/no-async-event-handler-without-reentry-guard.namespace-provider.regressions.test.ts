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

describe("no-async-event-handler-without-reentry-guard erased namespace providers", () => {
  it.each([
    { name: "direct", prefix: "require('react').useState = () => [false, () => {}];", expected: 1 },
    {
      name: "empty",
      prefix: "namespace require {} require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
    {
      name: "type-only",
      prefix:
        "namespace require { export interface Marker {} } require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
    {
      name: "nested",
      prefix:
        "namespace require { export namespace Inner { export type Marker = unknown; } } require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
    {
      name: "runtime",
      prefix:
        "namespace require { export const marker = 0; } require('react').useState = () => [false, () => {}];",
      expected: 1,
    },
  ])("preserves emitted binding: $name", ({ prefix, expected }) => {
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
