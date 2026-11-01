import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const cases = [
  {
    name: "stable-setter-erased-interface",
    code: 'import { useEffect, useState } from "react";\nexport const Counter = () => {\n  const [count, setCount] = useState(0);\n  interface setCount {}\n  useEffect(() => {\n    setCount(1);\n  }, []);\n  return <output>{count}</output>;\n};\n',
    expected: 0,
  },
  {
    name: "unstable-parameter-erased-interface",
    code: 'import { useEffect } from "react";\nexport const Counter = ({ setCount }: { setCount: (value: number) => void }) => {\n  interface setCount {}\n  useEffect(() => {\n    setCount(1);\n  }, []);\n  return null;\n};\n',
    expected: 1,
  },
];

describe("exhaustive-deps erased setter bindings", () => {
  for (const fixture of cases) {
    it(fixture.name, () => {
      const result = runRule(exhaustiveDeps, fixture.code, {
        settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
        includeLocations: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(fixture.expected);
    });
  }
});
