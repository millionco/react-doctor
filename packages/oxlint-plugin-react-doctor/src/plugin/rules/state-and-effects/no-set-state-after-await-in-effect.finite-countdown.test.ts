import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const cases = [
  {
    name: "setter-first finite 0",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 0; while (remaining > 0) { setValue(1); await load(); remaining -= 1; } }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "setter-first finite 1",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 1; while (remaining > 0) { setValue(1); await load(); remaining -= 1; } }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "setter-first finite 2",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 2; while (remaining > 0) { setValue(1); await load(); remaining -= 1; } }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "setter-first finite 3",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 3; while (remaining > 0) { setValue(1); await load(); remaining -= 1; } }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "reset-first finite 0",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 0; while (remaining > 0) { cancelled = false; await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "reset-first finite 1",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 1; while (remaining > 0) { cancelled = false; await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "reset-first finite 2",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 2; while (remaining > 0) { cancelled = false; await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "reset-first finite 3",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 3; while (remaining > 0) { cancelled = false; await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "finite wait without reset retains fresh postloop guard",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 2; while (remaining > 0) { await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "count1 after prior suspension remains unsafe",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { await load(); let remaining = 1; while (remaining > 0) { cancelled = false; await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "incoming old guard invalidates at next awaited reset",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { await load(); if (cancelled) return; let remaining = 2; while (remaining > 0) { cancelled = false; await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "immutable prop loop retains normal-exit refusal",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { while (keepGoing) { cancelled = false; await load(); } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "cancellation-controlled exit retains current guard",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { while (!cancelled) { cancelled = false; await load(); } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "opposite reset only in unreachable branch does not retire key",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 2; while (remaining > 0) { if (false) cancelled = false; await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "keeps the conservative fallback when an awaited helper writes the guard",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { const complete = async () => { cancelled = true; }; let remaining = 2; while (remaining > 0) { cancelled = false; await complete(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "unsafe floating count cannot certify exit",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 1e100; while (remaining > 0) { cancelled = false; await load(); remaining -= 1; } if (cancelled) return; setValue(1); }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "counter write in awaited closure cannot quiet repeated setter",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 1; const resetCounter = () => { remaining = 2; }; while (remaining > 0) { setValue(1); await resetCounter(); remaining -= 1; } }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "after-caller-await entry keeps fallback",
    source:
      'import { useEffect, useState } from "react"; export const Panel = ({ load }) => { const [value, setValue] = useState(0); useEffect(() => { const run = async () => { let remaining = 1; while (remaining > 0) { setValue(1); await load(); remaining -= 1; } }; const start = async () => { await load(); await run(); }; void start(); }, [load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "nested factory after caller await is not effect setup",
    source:
      'import { useEffect, useState } from "react"; export const Panel = ({ load }) => { const [value, setValue] = useState(0); useEffect(() => { const factory = () => { const run = async () => { let remaining = 1; while (remaining > 0) { setValue(1); await load(); remaining -= 1; } }; void run(); }; const start = async () => { await load(); factory(); }; void start(); }, [load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "refuses finite suppression when an immediately called helper also escapes to a timer",
    source:
      'import { useEffect, useState } from "react"; export const Panel = ({ load }) => { const [value, setValue] = useState(0); useEffect(() => { const run = async () => { let remaining = 1; while (remaining > 0) { setValue(1); await load(); remaining -= 1; } }; void run(); setTimeout(run, 100); }, [load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "extra counter write refuses literal1 quieting",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0);  useEffect(() => { let cancelled = false; const run = async () => { let remaining = 1; remaining = 2; while (remaining > 0) { setValue(1); await load(); remaining -= 1; } }; void run(); return () => { cancelled = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 1,
  },
  {
    name: "ref guard fallback remains intact",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ keepGoing, load }) => { const [value, setValue] = useState(0); const cancelledRef = useRef(false); useEffect(() => { let cancelled = false; const run = async () => { let remaining = 2; while (remaining > 0) { await load(); remaining -= 1; } if (cancelledRef.current) return; setValue(1); }; void run(); return () => { cancelledRef.current = true; }; }, [keepGoing, load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "sequence guard fallback remains intact",
    source:
      'import { useEffect, useState, useRef } from "react"; export const Panel = ({ load }) => { const [value, setValue] = useState(0); const sequence = useRef(0); useEffect(() => { const request = ++sequence.current; const run = async () => { let remaining = 2; while (remaining > 0) { await load(); remaining -= 1; } if (request !== sequence.current) return; setValue(1); }; void run(); return () => { sequence.current += 1; }; }, [load]); return value; };',
    diagnostics: 0,
  },
  {
    name: "literal false preserves old preawait-setter fallback",
    source:
      'import { useEffect, useState } from "react"; export const Panel = ({ load }) => { const [value, setValue] = useState(0); useEffect(() => { const run = async () => { while (false) { setValue(1); await load(); } }; void run(); }, [load]); return value; };',
    diagnostics: 0,
  },
];

describe("no-set-state-after-await-in-effect finite countdown exits", () => {
  it.each(cases)("$name", ({ source, diagnostics }) => {
    const result = runRule(noSetStateAfterAwaitInEffect, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnostics);
  });
});
