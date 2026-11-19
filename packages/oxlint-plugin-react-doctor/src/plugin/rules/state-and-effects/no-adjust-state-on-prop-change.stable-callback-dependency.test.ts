import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const source = `
import { useCallback, useEffect, useRef, useState } from "react";

export const usePreview = (initialText: string, prefix: string) => {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const prefixRef = useRef(prefix);
  useEffect(() => {
    prefixRef.current = prefix;
  }, [prefix]);

  const run = useCallback((value: string) => {
    setError(null);
    if (value !== prefixRef.current) setError("Invalid input");
  }, []);

  useEffect(() => {
    run(text);
  }, [text, run]);
  return { error, setText };
};
`;

describe("stable callback dependencies", () => {
  it("accepts state work triggered by local state and a stable callback", () => {
    const result = runRule(noAdjustStateOnPropChange, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "a direct prop dependency",
      code: source.replace("[text, run]", "[text, run, prefix]"),
    },
    { name: "a changing callback dependency", code: source.replace("}, []);", "}, [prefix]);") },
    {
      name: "dynamic callback dependencies",
      code: source.replace("}, []);", "}, [prefix].slice());"),
    },
    {
      name: "a callback member dependency",
      code: source.replace("[text, run]", "[text, run.version]"),
    },
    {
      name: "a callback nested in a spread",
      code: source.replace("[text, run]", "[text, ...[run]]"),
    },
    { name: "a mutable binding", code: source.replace("const run =", "let run =") },
    {
      name: "an unrelated callback provider",
      code: source.replace(
        'import { useCallback, useEffect, useRef, useState } from "react";',
        'import { useEffect, useRef, useState } from "react"; import { useCallback } from "other";',
      ),
    },
  ])("keeps reporting with $name", ({ code }) => {
    const result = runRule(noAdjustStateOnPropChange, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
