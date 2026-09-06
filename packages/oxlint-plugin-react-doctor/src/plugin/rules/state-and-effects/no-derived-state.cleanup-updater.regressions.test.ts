import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

describe.each([noDerivedState, noDerivedStateEffect])("cleanup-managed updater parity", (rule) => {
  it.each([
    [
      "a synchronous listener alone",
      "function update() { setSelected(items.slice(0, 1)); } update(); window.addEventListener('scroll', update); return () => window.removeEventListener('scroll', update);",
      1,
    ],
    [
      "a current-state updater with listener cleanup",
      "function update() { if (single) setSelected(items.slice(0, 1)); else setSelected((current) => current.length ? items.slice(items.indexOf(current[0])) : items.slice(-1)); } update(); window.addEventListener('scroll', update); return () => window.removeEventListener('scroll', update);",
      0,
    ],
    [
      "a current-state updater with cleanup",
      "function update() { if (single) setSelected(items.slice(0, 1)); else setSelected((current) => current.length ? items.slice(items.indexOf(current[0])) : items.slice(-1)); } update(); return () => {};",
      0,
    ],
    [
      "a current-state updater without cleanup",
      "function update() { if (single) setSelected(items.slice(0, 1)); else setSelected((current) => current.length ? items.slice(items.indexOf(current[0])) : items.slice(-1)); } update();",
      1,
    ],
    [
      "a constant updater with cleanup",
      "if (single) setSelected(items.slice(0, 1)); else setSelected(() => []); return () => {};",
      1,
    ],
    [
      "an unknown updater with cleanup",
      "if (single) setSelected(items.slice(0, 1)); else setSelected((current) => transform(current)); return () => {};",
      0,
    ],
  ])("preserves %s", (_caseName, effectBody, expectedCount) => {
    const source = `import { useEffect, useState } from 'react'; export const Preview = ({ items, single }) => { const [selected, setSelected] = useState([]); useEffect(() => { ${effectBody} }, [items, single]); return <div>{selected}</div>; };`;
    const result = runRule(rule, source, { filename: "src/preview.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
