import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactCompilerNoManualMemoization } from "./react-compiler-no-manual-memoization.js";

const run = (code: string) =>
  runRule(reactCompilerNoManualMemoization, code, { filename: "fixture.tsx" });

describe("architecture/react-compiler-no-manual-memoization — regressions", () => {
  it.each([
    ["an as assertion", "(React as any).memo"],
    ["a non-null assertion", "(React!).memo"],
  ])("flags React.memo through %s on its receiver", (_name, callee) => {
    const result = run(`import React from "react"; const C = ${callee}(Inner);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "a userland object",
      `const ReactTools = { memo: (value) => value };
       const C = (ReactTools as any).memo(Inner);`,
    ],
    [
      "a shadowing parameter",
      `import * as ReactTools from "react";
       const wrap = (ReactTools) => (ReactTools as any).memo(Inner);`,
    ],
    [
      "a shadowed named import",
      `import { memo } from "react";
       const wrap = (memo) => (memo as any)(Inner);`,
    ],
    [
      "a mutable local",
      `let ReactTools = { memo: (value) => value };
       const C = (ReactTools!).memo(Inner);`,
    ],
  ])("does not flag a wrapped memo method on %s", (_name, code) => {
    const result = run(code);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a wrapped React.memo call with a custom comparator", () => {
    const result = run(
      `import React from "react"; const C = (React as any).memo(Inner, (a, b) => a.id === b.id);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag memo() with a custom comparator", () => {
    const result = run(
      `import { memo } from "react"; const C = memo(Inner, (prev, next) => prev.id === next.id);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a plain memo() with no comparator", () => {
    const result = run(`import { memo } from "react"; const C = memo(Inner);`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags memo(Inner, undefined) — React falls back to shallow compare", () => {
    const result = run(`import { memo } from "react"; const C = memo(Inner, undefined);`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags memo(Inner, null) — React falls back to shallow compare", () => {
    const result = run(`import { memo } from "react"; const C = memo(Inner, null);`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag memo(Inner, ...rest) — the spread could carry a comparator", () => {
    const result = run(
      `import { memo } from "react"; const rest = []; const C = memo(Inner, ...rest);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an aliased memo import with a comparator", () => {
    const result = run(
      `import { memo as wrapMemo } from "react"; const C = wrapMemo(Inner, (a, b) => a.id === b.id);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag React.memo with a comparator", () => {
    const result = run(
      `import React from "react"; const C = React.memo(Inner, (a, b) => a.id === b.id);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag memo(Inner, comparatorIdentifier)", () => {
    const result = run(
      `import { memo } from "react"; const areEqual = (a, b) => a.id === b.id; const C = memo(Inner, areEqual);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag useCallback inside an anonymous arrow passed to a non-React HOC (NiceModal.create)", () => {
    const result = run(
      `import { useCallback } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
export const ShareDrawer = NiceModal.create(() => {
  const modal = useModal();
  const onClose = useCallback(() => {
    modal.hide();
  }, [modal]);
  return <button onClick={onClose} />;
});`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag useMemo inside a non-component, non-hook helper function", () => {
    const result = run(
      `import { useMemo } from "react";
const buildRenderer = (items) => {
  const rendered = useMemo(() => items.map((item) => item.id), [items]);
  return rendered;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags useCallback inside an anonymous arrow wrapped in memo()", () => {
    const result = run(
      `import { memo, useCallback } from "react";
export const Row = memo(({ onSelect }) => {
  const handleSelect = useCallback(() => onSelect(), [onSelect]);
  return <button onClick={handleSelect} />;
});`,
    );
    const useCallbackDiagnostics = result.diagnostics.filter((diagnostic) =>
      diagnostic.message.includes("useCallback"),
    );
    expect(useCallbackDiagnostics).toHaveLength(1);
  });

  it("still flags useCallback inside an anonymous arrow wrapped in forwardRef()", () => {
    const result = run(
      `import { forwardRef, useCallback } from "react";
export const Input = forwardRef((props, ref) => {
  const handleFocus = useCallback(() => props.onFocus(), [props.onFocus]);
  return <input ref={ref} onFocus={handleFocus} />;
});`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags useMemo inside a named custom hook", () => {
    const result = run(
      `import { useMemo } from "react";
export const useSortedItems = (items) => {
  return useMemo(() => [...items].sort(), [items]);
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag useCallback inside an anonymous default-export function", () => {
    const result = run(
      `import { useCallback } from "react";
export default function ({ onPress }) {
  const handlePress = useCallback(() => onPress(), [onPress]);
  return <button onClick={handlePress} />;
}`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
