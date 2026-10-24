import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

interface WhilePathCase {
  readonly name: string;
  readonly body: string;
  readonly diagnostics: number;
  readonly componentSetup?: string;
  readonly effectSetup?: string;
  readonly cleanup?: string;
}

const cases: WhilePathCase[] = [
  {
    name: "respects a cleanup that turns a live flag false",
    effectSetup: "let active = true;",
    cleanup: "active = false;",
    body: "while (keepGoing) { await load(); if (!active) return; setValue(1); }",
    diagnostics: 0,
  },
  {
    name: "respects a cancellation return after each await",
    body: "while (keepGoing) { await load(); if (cancelled) return; setValue(1); }",
    diagnostics: 0,
  },
  {
    name: "does not reuse a guard from before an await",
    body: "while (keepGoing) { if (cancelled) return; await load(); setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "carries suspension into the next iteration",
    body: "while (keepGoing) { setValue(1); await load(); }",
    diagnostics: 1,
  },
  {
    name: "reports an unguarded write after await",
    body: "while (keepGoing) { await load(); setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "carries suspension out of the loop",
    body: "let remaining = 2; while (remaining > 0) { await load(); remaining -= 1; } setValue(1);",
    diagnostics: 1,
  },
  {
    name: "retains a cancellation return when the loop finishes",
    body: "let remaining = 2; while (remaining > 0) { await load(); if (cancelled) return; remaining -= 1; } setValue(1);",
    diagnostics: 0,
  },
  {
    name: "invalidates a cancellation check at another await",
    body: "while (keepGoing) { await load(); if (cancelled) return; await other(); setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "respects a guarded consequent inside the loop",
    body: "while (keepGoing) { await load(); if (!cancelled) { setValue(1); } }",
    diagnostics: 0,
  },
  {
    name: "joins nested loop paths",
    body: "while (keepGoing) { while (keepGoing) { await load(); if (cancelled) return; setValue(1); } }",
    diagnostics: 0,
  },
  {
    name: "retains a suspension before entering the loop",
    body: "await load(); while (keepGoing) { setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "checks cancellation again before the next iteration",
    body: "while (!cancelled && keepGoing) { setValue(1); await load(); }",
    diagnostics: 0,
  },
  {
    name: "does not treat a loop condition as a post-await check",
    body: "while (!cancelled && keepGoing) { await load(); setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "does not carry a loop-body guard onto a zero-iteration path",
    body: "await load(); while (keepGoing) { if (cancelled) return; } setValue(1);",
    diagnostics: 1,
  },
  {
    name: "allows a different branch on the next iteration",
    body: "let turn = false; while (keepGoing) { if (turn) { setValue(1); } else { await load(); } turn = !turn; }",
    diagnostics: 1,
  },
  {
    name: "does not freshen a cached loop condition on the backedge",
    body: "const alive = !cancelled; while (alive) { setValue(1); await load(); }",
    diagnostics: 1,
  },
  {
    name: "does not freshen a cached condition inside a logical test",
    body: "const alive = !cancelled; while (alive && keepGoing) { setValue(1); await load(); }",
    diagnostics: 1,
  },
  {
    name: "does not reuse a flag reset before the textual await on a later iteration",
    body: "while (keepGoing) { cancelled = false; if (cancelled) return; setValue(1); await load(); }",
    diagnostics: 1,
  },
  {
    name: "follows a local helper that resets the flag on each iteration",
    body: "const reset = () => { cancelled = false; }; while (keepGoing) { reset(); if (cancelled) return; setValue(1); await load(); }",
    diagnostics: 1,
  },
  {
    name: "retains a warning when the next iteration erases cancellation from a later await",
    body: "while (keepGoing) { cancelled = false; await load(); if (cancelled) return; setValue(1); await other(); }",
    diagnostics: 1,
  },
  {
    name: "does not reuse a reassigned sequence snapshot on the next iteration",
    body: "let sequence = 0; let request = ++sequence; while (keepGoing) { request = sequence; await load(); if (request !== sequence) return; setValue(1); await other(); }",
    diagnostics: 1,
  },
  {
    name: "does not certify a flag reset by a getter outside the loop",
    body: "const resets = { get value() { cancelled = false; return 0; } }; while (keepGoing) { await load(); resets.value; if (cancelled) return; setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "preserves the existing fallback for ref cancellation guards",
    componentSetup: "const cancelled = useRef(false);",
    effectSetup: "",
    cleanup: "cancelled.current = true;",
    body: "while (keepGoing) { await load(); if (cancelled.current) return; setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "preserves the ref helper mutation warning",
    componentSetup: "const cancelled = useRef(false);",
    effectSetup: "",
    cleanup: "cancelled.current = true;",
    body: "const reset = (flag) => { flag.current = false; }; while (keepGoing) { reset(cancelled); await load(); if (cancelled.current) return; setValue(1); await other(); }",
    diagnostics: 1,
  },
  {
    name: "does not certify a scalar flag when direct eval can reset it",
    body: 'while (keepGoing) { await load(); eval("cancelled = false"); if (cancelled) return; setValue(1); }',
    diagnostics: 1,
  },
  {
    name: "does not mistake an erased eval interface for a runtime replacement",
    body: 'interface eval {} while (keepGoing) { await load(); eval("cancelled = false"); if (cancelled) return; setValue(1); }',
    diagnostics: 1,
  },
  {
    name: "does not certify direct eval through a TypeScript wrapper",
    body: 'while (keepGoing) { await load(); (eval as typeof eval)("cancelled = false"); if (cancelled) return; setValue(1); }',
    diagnostics: 1,
  },
  {
    name: "retains return-expression warnings",
    body: "while (keepGoing) { return setValue(await load()); }",
    diagnostics: 1,
  },
  {
    name: "retains throw-expression warnings",
    body: "while (keepGoing) { throw setValue(await load()); }",
    diagnostics: 1,
  },
  {
    name: "retains eventful cancellation-exit warnings",
    body: "while (keepGoing) { await load(); if (cancelled) { setValue(1); return; } }",
    diagnostics: 1,
  },
  {
    name: "retains suspension inside a cancellation-exit block",
    body: "while (keepGoing) { await load(); if (cancelled) { await other(); setValue(1); return; } }",
    diagnostics: 1,
  },
  {
    name: "retains enclosing finally warnings",
    body: "try { while (keepGoing) { await load(); if (cancelled) return; } } finally { setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "retains break-path suspension debt",
    body: "while (keepGoing) { await load(); if (cancelled) break; setValue(1); } setValue(2);",
    diagnostics: 1,
  },
  {
    name: "retains continue-path warnings",
    body: "while (keepGoing) { await load(); if (cancelled) continue; setValue(1); }",
    diagnostics: 1,
  },
  {
    name: "does not recognize a guard for a different variable",
    body: "let otherCancelled = false; while (keepGoing) { await load(); if (otherCancelled) return; setValue(1); }",
    diagnostics: 1,
  },
];

describe("no-set-state-after-await-in-effect while paths", () => {
  it.each(cases)(
    "$name",
    ({
      body,
      diagnostics,
      componentSetup = "",
      effectSetup = "let cancelled = false;",
      cleanup = "cancelled = true;",
    }) => {
      const result = runRule(
        noSetStateAfterAwaitInEffect,
        `import { useEffect, useState, useRef } from "react";
       export const Panel = ({ keepGoing }) => {
         const [value, setValue] = useState(0);
         ${componentSetup}
         useEffect(() => {
           ${effectSetup}
           const run = async () => { ${body} };
           void run();
           return () => { ${cleanup} };
         }, [keepGoing]);
         return value;
       };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(diagnostics);
    },
  );
});
