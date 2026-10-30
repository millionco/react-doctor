import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoStateInUseFrame } from "./r3f-no-state-in-use-frame.js";

describe("r3f-no-state-in-use-frame early returns", () => {
  it.each([
    {
      name: "preceding direct true-state bare return",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { if (ready) return; setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 0,
    },
    {
      name: "same state exit above unrelated ref threshold",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  const ticks = useRef(3);\n  useFrame(() => { if (ready) return; ticks.current -= 1; if (ticks.current <= 0) { setReady(true); } });\n  return null;\n};\n',
      expectedDiagnostics: 0,
    },
    {
      name: "symmetric false-state transition",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [active, setActive] = useState(true);\n  useFrame(() => { if (!active) return; setActive(false); });\n  return null;\n};\n',
      expectedDiagnostics: 0,
    },
    {
      name: "single bare return block",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { if (ready) { return; } if (Math.random() > 0.5) setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 0,
    },
    {
      name: "existing enclosing boolean guard remains quiet",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { if (!ready) { setReady(true); } });\n  return null;\n};\n',
      expectedDiagnostics: 0,
    },
    {
      name: "wrong state symbol does not certify setter",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  const [other] = useState(false);\n  useFrame(() => { if (other) return; setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "nonterminating observation is not an exit guard",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { if (ready) console.log("done"); setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "guard following setter is not preceding",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { setReady(true); if (ready) return; });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "nested IIFE return does not exit frame callback",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { (() => { if (ready) return; })(); setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "guard within conditional sibling is not dominating",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { if (Math.random() > 0.5) { if (ready) return; } setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "repeated-execution setter remains reportable",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { if (ready) return; for (let count = 0; count < 10; count += 1) setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "functional updater does not establish fixed target",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { if (ready) return; setReady((previous) => !previous); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "opposite return polarity does not certify transition",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { if (!ready) return; setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "local called helper bridge stays outside v1",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  const complete = () => setReady(true);\n  useFrame(() => { if (ready) return; complete(); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "setter escape prevents new certificate",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  const expose = (value) => console.log(value);\n  expose(setReady);\n  useFrame(() => { if (ready) return; setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "second same-owner setter site prevents new certificate",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  const reset = () => setReady(false);\n  const onReset = () => reset();\n  useFrame(() => { if (ready) return; setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "mutated setter binding prevents new certificate",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  let [ready, setReady] = useState(false);\n  setReady = (value) => console.log(value);\n  useFrame(() => { if (ready) return; setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "try-finally return cannot guard finally setter",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { try { if (ready) return; } finally { setReady(true); } });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
    {
      name: "unused callback is not executed",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(() => { const later = () => { if (ready) return; setReady(true); }; });\n  return null;\n};\n',
      expectedDiagnostics: 0,
    },
    {
      name: "asynchronous frame callback outside new arm",
      source:
        'import { useState, useRef } from "react";\nimport { useFrame } from "@react-three/fiber";\nconst Panel = () => {\n  const [ready, setReady] = useState(false);\n  useFrame(async () => { if (ready) return; await Promise.resolve(); setReady(true); });\n  return null;\n};\n',
      expectedDiagnostics: 1,
    },
  ])("$name", ({ source, expectedDiagnostics }) => {
    expect(runRule(r3fNoStateInUseFrame, source).diagnostics).toHaveLength(expectedDiagnostics);
  });
});

describe("r3f early return certificate boundaries", () => {
  it.each([
    {
      name: "keeps dispatcher aliases outside the certificate",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); const update = setSettled; useFrame(() => { if (settled) return; setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "keeps lazy initializers outside the certificate",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(() => false); useFrame(() => { if (settled) return; setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "preserves named import aliases",
      source:
        'import { useState as useFlag } from "react"; import { useFrame as onFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useFlag(false); onFrame(() => { if (settled) return; setSettled(true); }); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "preserves React namespace provenance",
      source:
        'import * as React from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = React.useState(false); useFrame(() => { if (settled) return; setSettled(true); }); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "rejects extra setter arguments",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (settled) return; setSettled(true, readValue()); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects value-returning guards",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (settled) return 4; setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects throw exits",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (settled) throw new Error("done"); setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects guards with additional branch statements",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (settled) { record(); return; } setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects logical guard expressions",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (settled || unavailable) return; setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects duplicate negation guard expressions",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (!!settled) return; setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects guards with alternate branches",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (settled) return; else record(); setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects mutable state tuple bindings",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { let [settled, setSettled] = useState(false); useFrame(() => { if (settled) return; setSettled(true); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects setters in try regions",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (settled) return; try { setSettled(true); } finally { record(); } }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects immediate nested functions",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); useFrame(() => { if (settled) return; (() => setSettled(true))(); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "retains an unrelated state update warning",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); const [count, setCount] = useState(0); useFrame(() => { if (settled) return; setSettled(true); setCount(count + 1); }); return count; };',
      expectedDiagnostics: 1,
    },
    {
      name: "resolves a stable frame callback",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Box = () => { const [settled, setSettled] = useState(false); const frame = () => { if (settled) return; setSettled(true); }; useFrame(frame); return null; };',
      expectedDiagnostics: 0,
    },
  ])("$name", ({ source, expectedDiagnostics }) => {
    expect(runRule(r3fNoStateInUseFrame, source).diagnostics).toHaveLength(expectedDiagnostics);
  });
});

describe("r3f early return callback provenance", () => {
  it.each([
    {
      name: "rejects a callback with stale memoized state",
      source:
        'import {useState,useCallback} from "react"; import {useFrame} from "@react-three/fiber"; const Box=()=>{ const [settled,setSettled]=useState(false); const frame=useCallback(()=>{if(settled)return;setSettled(true)},[]);useFrame(frame); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects a memoized alias of a fresh callback",
      source:
        'import {useState,useCallback} from "react"; import {useFrame} from "@react-three/fiber"; const Box=()=>{ const [settled,setSettled]=useState(false); const tick=()=>{if(settled)return;setSettled(true)};const frame=useCallback(tick,[]);useFrame(frame); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "keeps memoized dependency proof outside this certificate",
      source:
        'import {useState,useCallback} from "react"; import {useFrame} from "@react-three/fiber"; const Box=()=>{ const [settled,setSettled]=useState(false); const frame=useCallback(()=>{if(settled)return;setSettled(true)},[settled]);useFrame(frame); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "rejects callbacks that escape before registration",
      source:
        'import {useState,useCallback} from "react"; import {useFrame} from "@react-three/fiber"; const Box=()=>{ const [settled,setSettled]=useState(false); const frame=()=>{if(settled)return;setSettled(true)};cacheCallback(frame);useFrame(frame); return null; };',
      expectedDiagnostics: 1,
    },
  ])("$name", ({ source, expectedDiagnostics }) => {
    expect(runRule(r3fNoStateInUseFrame, source).diagnostics).toHaveLength(expectedDiagnostics);
  });
});

describe("r3f early return named callback ownership", () => {
  it.each([
    [
      "inline named recursive call",
      "useFrame(function frame() { if (ready) return; setReady(true); frame(); });",
      1,
    ],
    [
      "inline named callback escape",
      "useFrame(function frame() { if (ready) return; setReady(true); queueMicrotask(frame); });",
      1,
    ],
    [
      "const arrow recursive control",
      "const frame = () => { if (ready) return; setReady(true); frame(); }; useFrame(frame);",
      1,
    ],
    [
      "nonrecursive named callback",
      "useFrame(function frame() { if (ready) return; setReady(true); });",
      0,
    ],
    ["anonymous callback", "useFrame(() => { if (ready) return; setReady(true); });", 0],
    [
      "readonly function name",
      "useFrame(function frame() { void frame.name; if (ready) return; setReady(true); });",
      0,
    ],
    [
      "readonly function length",
      "useFrame(function frame() { void frame.length; if (ready) return; setReady(true); });",
      0,
    ],
    [
      "readonly function typeof",
      "useFrame(function frame() { void typeof frame; if (ready) return; setReady(true); });",
      0,
    ],
    [
      "static dead self call",
      "useFrame(function frame() { if (false) frame(); if (ready) return; setReady(true); });",
      0,
    ],
    [
      "static dead BigInt self call",
      "useFrame(function frame() { if (0n) frame(); if (ready) return; setReady(true); });",
      0,
    ],
    [
      "short circuited self call",
      "useFrame(function frame() { false && frame(); if (ready) return; setReady(true); });",
      0,
    ],
    [
      "shadowed same-name callback",
      "useFrame(function frame() { { const frame = () => {}; frame(); } if (ready) return; setReady(true); });",
      0,
    ],
    [
      "called metadata cannot prove harmlessness",
      "useFrame(function frame() { frame.name(); if (ready) return; setReady(true); });",
      1,
    ],
    [
      "metadata write cannot prove harmlessness",
      'useFrame(function frame() { frame.name = "other"; if (ready) return; setReady(true); });',
      1,
    ],
    [
      "deferred self use crosses apparent dead enclosing declaration",
      "useFrame(function frame() { const nested = () => { if (unknown) frame(); }; retain(nested); if (ready) return; setReady(true); });",
      1,
    ],
  ])("%s", (_name, body, expectedCount) => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react";
      import { useFrame } from "@react-three/fiber";
      const Panel = () => {
        const [ready, setReady] = useState(false);
        ${body}
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});

describe("r3f early-return lexical eval ownership", () => {
  it.each([
    {
      name: "direct eval callback reentry",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Panel = () => { const [ready, setReady] = useState(false); useFrame(function frame() { if (ready) return; setReady(true); eval("frame()"); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "direct eval hidden reset",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Panel = () => { const [ready, setReady] = useState(false); useFrame(() => { if (ready) return; setReady(true); eval("setReady(false)"); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "parenthesized direct eval reentry",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Panel = () => { const [ready, setReady] = useState(false); useFrame(function frame() { if (ready) return; setReady(true); (eval)("frame()"); }); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "member eval does not see lexical latch",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Panel = () => { const [ready, setReady] = useState(false); useFrame(function frame() { if (ready) return; setReady(true); tools.eval("frame()"); }); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "indirect eval does not see lexical latch",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Panel = () => { const [ready, setReady] = useState(false); useFrame(function frame() { if (ready) return; setReady(true); (0,eval)("frame()"); }); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "local member named eval is not direct eval",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Panel = () => { const [ready, setReady] = useState(false); const local = {eval: value => value}; useFrame(function frame() { if (ready) return; setReady(true); local.eval("frame()"); }); return null; };',
      expectedDiagnostics: 0,
    },
    {
      name: "outer lexical helper eval reset",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Panel = () => { const [ready,setReady]=useState(false); const reset=()=>eval("setReady(false)"); useFrame(()=>{if(ready)return;setReady(true);reset();}); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "nested deferred eval reset",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Panel = () => { const [ready,setReady]=useState(false); useFrame(()=>{if(ready)return;setReady(true);queueMicrotask(()=>eval("setReady(false)"));}); return null; };',
      expectedDiagnostics: 1,
    },
    {
      name: "unrelated sibling eval owner remains independent",
      source:
        'import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Other = () => { eval("unrelated()"); return null; }; const Panel = () => { const [ready,setReady]=useState(false); useFrame(()=>{if(ready)return;setReady(true);}); return null; };',
      expectedDiagnostics: 0,
    },
  ])("$name", ({ source, expectedDiagnostics }) => {
    const result = runRule(r3fNoStateInUseFrame, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});
