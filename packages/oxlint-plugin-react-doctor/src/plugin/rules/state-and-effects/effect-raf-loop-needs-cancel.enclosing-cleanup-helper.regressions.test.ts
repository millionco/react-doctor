import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { effectRafLoopNeedsCancel } from "./effect-raf-loop-needs-cancel.js";

interface EnclosingCleanupHelperCase {
  name: string;
  code: string;
  expectedCount: number;
}

const commonOptions: RunRuleOptions = {
  filename: "independent-raf-helper.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: { "react-doctor": { capabilities: ["react"] }, react: { version: "19.0.0" } },
};
const cases: EnclosingCleanupHelperCase[] = [
  {
    name: "enclosing-guarded-cancel-helper",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "inline-cancellation-legacy",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); };  frameId = requestAnimationFrame(tick); return () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "enclosing-direct-cancel-helper",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { cancelAnimationFrame(frameId); }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "missing-cancel",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => {}; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "wrong-handle-cancel",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; let otherFrameId = 0; const stop = () => { cancelAnimationFrame(otherFrameId); }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "opaque-work-in-helper-abstention",
    code: 'import { useEffect } from "react";\ndeclare const inspect: () => void;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { inspect(); cancelAnimationFrame(frameId); }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "data-object-method-abstention",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const controls = { stop: () => { cancelAnimationFrame(frameId); } }; frameId = requestAnimationFrame(tick); return () => { controls.stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "reassigned-helper-abstention",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; let stop = () => { cancelAnimationFrame(frameId); }; stop = () => {}; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "helper-alias-escape-abstention",
    code: 'import { useEffect } from "react";\ndeclare const consume: (value: unknown) => void;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; const alias = stop; consume(alias); frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "shadowed-canceller-abstention",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const cancelAnimationFrame = (value: number) => {}; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "visible-canceller-write-abstention",
    code: 'import { useEffect } from "react";\ndeclare const replacement: typeof cancelAnimationFrame; globalThis.cancelAnimationFrame = replacement;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "shared-outer-handle-abstention",
    code: 'import { useEffect } from "react";\nlet frameId = 0;\nexport const Example = () => { useEffect(() => {  const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "cleanup-reset-before-helper-abstention",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { frameId = 0; stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "recursive-helper-abstention",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { stop(); cancelAnimationFrame(frameId); }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "conditional-cleanup-helper-abstention",
    code: 'import { useEffect } from "react";\ndeclare const enabled: boolean;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { if (enabled) stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "async-helper-abstention",
    code: 'import { useEffect } from "react";\ndeclare const pending: Promise<void>;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = async () => { await pending; cancelAnimationFrame(frameId); }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "enclosing-flag-helper-legacy",
    code: 'import { useEffect } from "react"; export const Example = () => { useEffect(() => { let active = true; const tick = () => { if (!active) return; requestAnimationFrame(tick); }; const stop = () => { active = false; }; requestAnimationFrame(tick); return () => stop(); }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "extra-helper-argument-abstention",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(1); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "same-handle-observer-calls-and-start-guard",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; const start = () => { if (frameId === 0) frameId = requestAnimationFrame(tick); }; const observer = new IntersectionObserver(([entry]) => { entry.isIntersecting ? start() : stop(); }); start(); return () => { stop(); observer.disconnect(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "readonly-window-member-canceller",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { window.cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "readonly-self-member-canceller",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { self.cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "unrelated-browser-scalar-read",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const pixelRatio = window.devicePixelRatio; void pixelRatio; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "helper-object-pattern-write",
    code: 'import { useEffect } from "react";\ndeclare const replacement: { stop: () => void };\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; ({ stop } = replacement); frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "helper-array-pattern-write",
    code: 'import { useEffect } from "react";\ndeclare const replacement: Array<() => void>;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; [stop] = replacement; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "helper-loop-pattern-write",
    code: 'import { useEffect } from "react";\ndeclare const replacements: Array<{ stop: () => void }>;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; for ({ stop } of replacements) {} frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "helper-direct-value-transport",
    code: 'import { useEffect } from "react";\ndeclare const consume: (value: unknown) => void;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; consume(stop); frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "handle-write-in-another-callback",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; const reset = () => { frameId = 0; }; void reset; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "handle-value-alias-unsupported",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; const previousFrameId = frameId; void previousFrameId; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "opaque-work-before-cleanup-helper",
    code: 'import { useEffect } from "react";\ndeclare const inspect: () => void;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { inspect(); stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "cleanup-work-after-helper",
    code: 'import { useEffect } from "react";\ndeclare const inspect: () => void;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); inspect(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "wrong-helper-zero-guard",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId === 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "helper-alternate-work-unsupported",
    code: 'import { useEffect } from "react";\ndeclare const inspect: () => void;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } else { inspect(); } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "global-canceller-assignment",
    code: 'import { useEffect } from "react";\ndeclare const replacement: typeof cancelAnimationFrame; cancelAnimationFrame = replacement;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "global-object-alias-exposure",
    code: 'import { useEffect } from "react";\nconst browser = globalThis; void browser;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "computed-global-member-uncertainty",
    code: 'import { useEffect } from "react";\ndeclare const property: string; void globalThis[property];\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "typed-local-does-not-hide-cancellation",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const phase: number = 0; void phase; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "runtime-enum-handle-write-unsupported",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; enum Phase { Ready = (frameId = 0) } frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "native-canceller-type-query-only",
    code: 'import { useEffect } from "react";\ntype Canceller = typeof cancelAnimationFrame;\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 0,
  },
  {
    name: "async-cleanup-unsupported",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return async () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "normal-function-helper-unsupported",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = function () { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "genuine-eval-reference-declines-lexical-handle-proof",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { void eval; let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "known-document-default-view-exposure",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { void document.defaultView; let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "helper-declaration-after-cleanup-return",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; frameId = requestAnimationFrame(tick); return () => { stop(); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } };  }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "handle-declaration-after-cleanup-return",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; let frameId = 0; }, []); return null; };',
    expectedCount: 1,
  },
  {
    name: "document-default-view-static-extraction-unsupported",
    code: 'import { useEffect } from "react";\n\nexport const Example = () => { useEffect(() => { const { defaultView } = document; void defaultView; let frameId = 0; const tick = () => { frameId = requestAnimationFrame(tick); }; const stop = () => { if (frameId !== 0) { cancelAnimationFrame(frameId); frameId = 0; } }; frameId = requestAnimationFrame(tick); return () => { stop(); }; }, []); return null; };',
    expectedCount: 1,
  },
];

describe("effect-raf-loop-needs-cancel enclosing cleanup helper", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(effectRafLoopNeedsCancel, testCase.code, commonOptions);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
