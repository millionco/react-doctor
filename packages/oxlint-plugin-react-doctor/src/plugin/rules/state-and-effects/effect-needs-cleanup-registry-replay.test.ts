import { expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

it.each([
  ["direct", "return () => cleanups.forEach((cleanup) => cleanup());", 0],
  [
    "extracted",
    "const release = () => cleanups.forEach((cleanup) => cleanup()); return () => release();",
    0,
  ],
  [
    "single-return helper",
    "const release = () => { return cleanups.forEach((cleanup) => cleanup()); }; return () => release();",
    0,
  ],
  [
    "helper chain",
    "const replay = () => cleanups.forEach((cleanup) => cleanup()); const release = () => replay(); return () => release();",
    0,
  ],
  [
    "conditional invocation",
    "const release = () => cleanups.forEach((cleanup) => cleanup()); return () => { if (enabled) release(); };",
    1,
  ],
  [
    "uncalled helper",
    "const release = () => cleanups.forEach((cleanup) => cleanup()); return () => {};",
    1,
  ],
  [
    "shadowed helper",
    "const release = () => cleanups.forEach((cleanup) => cleanup()); return () => { const release = () => undefined; release(); };",
    1,
  ],
  [
    "replaced helper",
    "let release = () => cleanups.forEach((cleanup) => cleanup()); release = () => undefined; return () => release();",
    1,
  ],
  [
    "helper after return",
    "return () => release(); const release = () => cleanups.forEach((cleanup) => cleanup());",
    1,
  ],
  [
    "helper cycle",
    "const release = () => repeat(); const repeat = () => release(); return () => release();",
    1,
  ],
  [
    "generator helper",
    "const release = function* () { yield cleanups.forEach((cleanup) => cleanup()); }; return () => release();",
    1,
  ],
  [
    "deferred helper",
    "const release = async () => { await ready(); cleanups.forEach((cleanup) => cleanup()); }; return () => release();",
    1,
  ],
  [
    "emptied registry",
    "const release = () => { cleanups.length = 0; return cleanups.forEach((cleanup) => cleanup()); }; return () => release();",
    1,
  ],
  [
    "uncalled disposers",
    "const release = () => cleanups.forEach((cleanup) => undefined); return () => release();",
    1,
  ],
])("preserves registry replay ownership: %s", (_, release, diagnosticCount) => {
  const result = runRule(
    effectNeedsCleanup,
    `import { useEffect } from "react";
    export const Panel = ({ targets, enabled }) => {
      useEffect(() => {
        const cleanups = [];
        for (const target of targets) {
          const handler = () => undefined;
          target.addEventListener("change", handler);
          cleanups.push(() => target.removeEventListener("change", handler));
        }
        ${release}
      }, [targets, enabled]);
      return null;
    };`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(diagnosticCount);
});
