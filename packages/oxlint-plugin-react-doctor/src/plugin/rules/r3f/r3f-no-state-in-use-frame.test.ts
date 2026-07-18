import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoStateInUseFrame } from "./r3f-no-state-in-use-frame.js";

describe("r3f-no-state-in-use-frame", () => {
  it("flags imported React state setters called each frame", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(0); useFrame(() => setCount((value) => value + 1)); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `const Fiber = require("@react-three/fiber"); const React = require("react"); const [, setCount] = React.useState(0); Fiber.useFrame(() => setCount(1));`,
    `const { useFrame } = require("@react-three/fiber"); const { useReducer } = require("react"); const [, dispatch] = useReducer(reducer, 0); useFrame(() => dispatch(action));`,
    `const { useFrame } = require("@react-three/fiber"); const [, setCount] = require("react").useState(0); useFrame(() => setCount(1));`,
    `import Fiber = require("@react-three/fiber"); import React = require("react"); const [, setCount] = React.useState(0); Fiber.useFrame(() => setCount(1));`,
    `import Fiber = require("@react-three/fiber"); import React = require("react"); import state = React.useState; const [, setCount] = state(0); Fiber.useFrame(() => setCount(1));`,
  ])("flags CommonJS React state setters called each frame", (code) => {
    const result = runRule(r3fNoStateInUseFrame, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores state hooks from shadowed CommonJS loaders", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `const Fiber = require("@react-three/fiber"); const Scene = (require) => { const React = require("react"); const [, setCount] = React.useState(0); Fiber.useFrame(() => setCount(1)); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores CommonJS state hooks called after namespace mutation", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `const Fiber = require("@react-three/fiber"); const React = require("react"); React.useState = createState; const [, setCount] = React.useState(0); Fiber.useFrame(() => setCount(1));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags state and reducer setters when the value slot is elided", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useReducer, useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [, setCount] = useState(0); const [, forceUpdate] = useReducer((value) => value + 1, 0); useFrame(() => { setCount((value) => value + 1); forceUpdate(); }); };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves state setters declared after useFrame", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useReducer, useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { useFrame(() => { setCount((value) => value + 1); forceUpdate(); }); const [, setCount] = useState(0); const [, forceUpdate] = useReducer((value) => value + 1, 0); };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows a guarded discrete transition and ignores shadowed setters", () => {
    const guarded = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [outside, setOutside] = useState(false); useFrame(() => { const next = test(); if (next !== outside) setOutside(next); }); };`,
    );
    const shadowed = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(0); useFrame(() => { const setCount = log; setCount(1); }); };`,
    );
    expect(guarded.diagnostics).toHaveLength(0);
    expect(shadowed.diagnostics).toHaveLength(0);
  });

  it("allows a guarded boolean latch transition with related state updates", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [started, setStarted] = useState(false); const [failed, setFailed] = useState(false); useFrame(() => { if (started && didFail()) { setStarted(false); setFailed(true); } }); return failed; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps non-converging boolean guards reportable", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [active, setActive] = useState(true); const [count, setCount] = useState(0); useFrame(() => { if (active) { setActive(true); setCount((value) => value + 1); } else { setActive(false); } }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("keeps split boolean toggles reportable", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [active, setActive] = useState(true); useFrame(() => { if (active) setActive(false); if (!active) setActive(true); }); return active; };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still flags a truthiness guard that can update every frame", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [active, setActive] = useState(true); useFrame(() => { if (active) setActive(true); }); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows previous-value comparison guards", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState, useRef } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [tiles, setTiles] = useState([]); const previous = useRef(""); useFrame(() => { const next = readKey(); if (next !== previous.current) { previous.current = next; setTiles(buildTiles()); } }); return null; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows exception-only state transitions", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [error, setError] = useState(null); useFrame(() => { try { update(); } catch (caughtError) { setError(caughtError); } }); return error; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps state threshold guards reportable", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { if (count !== 0) setCount(count + 1); }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps wrapped primitive threshold guards reportable", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { if (count !== (0 as number)) setCount(count + 1); if (count !== (undefined)) setCount(count + 1); }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps void threshold guards reportable", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { if (count !== void 0) setCount(count + 1); if (void (0) === count) setCount(count + 1); }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores comparisons inside nested predicate callbacks", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { if (items.some((item) => item.id !== selectedId)) setCount(count + 1); }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("only allows the branch where compared values differ", () => {
    const unsafeElse = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { const next = readCount(); if (next !== count) logChange(); else setCount(next); }); return count; };`,
    );
    const safeElse = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { const next = readCount(); if (next === count) logStable(); else setCount(next); }); return count; };`,
    );
    expect(unsafeElse.diagnostics).toHaveLength(1);
    expect(safeElse.diagnostics).toHaveLength(0);
  });

  it("allows ternary and short-circuit branches where compared values differ", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { const next = readCount(); next !== count ? setCount(next) : logStable(); next === count ? logStable() : setCount(next); next !== count && setCount(next); next === count || setCount(next); }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports ternary and short-circuit branches where compared values are equal", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { const next = readCount(); next === count ? setCount(next) : logChange(); next !== count || setCount(next); }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("preserves branch guarantees through boolean conditions", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { const next = readCount(); if (!(next === count)) setCount(next); if (isReady || next !== count) setCount(next); }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a transition comparison stored in a const", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(1); useFrame(() => { const next = readCount(); const didCountChange = next !== count; if (didCountChange) setCount(next); }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("follows a stable setter alias", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [count, setCount] = useState(0); const updateCount = setCount; useFrame(() => updateCount(count + 1)); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
