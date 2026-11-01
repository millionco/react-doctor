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

describe("runtime imported provider reference attribution", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "useState-direct",
      prefix: "const rewriteProvider=()=>{ mutate(useState);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useState-interface",
      prefix:
        "const rewriteProvider=()=>{interface useState {} mutate(useState);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "useState-typealias",
      prefix:
        "const rewriteProvider=()=>{type useState=unknown; mutate(useState);}; rewriteProvider();",
      expected: 1,
    },
  ])("preserves runtime exposure: $name", ({ prefix, expected }) => {
    const result = runRule(noAsyncEventHandlerWithoutReentryGuard, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
