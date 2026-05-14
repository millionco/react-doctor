import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("rerender-dependencies");

describe("rerender-dependencies (extended to inline functions)", () => {
  it("flags an ArrowFunctionExpression in a useEffect deps array", async () => {
    // https://react.dev/learn/removing-effect-dependencies#does-some-reactive-value-change-unintentionally
    const projectDir = setupReactProject(tempRoot, "rerender-dependencies-arrow", {
      files: {
        "src/Sync.tsx": `import { useEffect } from "react";

declare const subscribe: (handler: () => void) => () => void;

export const Sync = () => {
  useEffect(() => {
    const unsubscribe = subscribe(() => {});
    return unsubscribe;
  }, [() => "fresh-each-render"]);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-dependencies");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((hit) => hit.message.includes("Inline function"))).toBe(true);
  });

  it("flags a FunctionExpression in a useCallback deps array", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-dependencies-fn-expr", {
      files: {
        "src/Memo.tsx": `import { useCallback } from "react";

export const Memo = () => {
  const callback = useCallback(
    () => {},
    [function unstable() {}],
  );
  return <button onClick={callback}>x</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-dependencies");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag a stable function reference (Identifier) in deps", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-dependencies-identifier", {
      files: {
        "src/Stable.tsx": `import { useCallback, useEffect, useMemo } from "react";

export const Stable = ({ onChange }: { onChange: () => void }) => {
  const memoized = useMemo(() => 1, [onChange]);
  const callback = useCallback(() => memoized, [memoized, onChange]);
  useEffect(() => {
    callback();
  }, [callback]);
  return <span>{memoized}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-dependencies");
    expect(hits).toHaveLength(0);
  });
});
