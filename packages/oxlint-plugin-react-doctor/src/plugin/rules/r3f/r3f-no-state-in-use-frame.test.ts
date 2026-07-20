import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoStateInUseFrame } from "./r3f-no-state-in-use-frame.js";

describe("r3f-no-state-in-use-frame", () => {
  it("allows state transitions guarded by a ref latch", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useRef, useState } from "react";
      const Scene = ({ controller }) => {
        const pressedRef = useRef(false);
        const [enabled, setEnabled] = useState(false);
        useFrame(() => {
          if (controller.pressed && !pressedRef.current) {
            pressedRef.current = true;
            setEnabled((current) => !current);
          }
        });
        return enabled ? <mesh /> : null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(0);
  });

  it("reports a ref latch written after the state transition", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useRef, useState } from "react";
      const Scene = ({ pressed }) => {
        const pressedRef = useRef(false);
        const [enabled, setEnabled] = useState(false);
        useFrame(() => {
          if (pressed && !pressedRef.current) {
            setEnabled((current) => !current);
            pressedRef.current = true;
          }
        });
        return enabled ? <mesh /> : null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(1);
  });

  it("allows state transitions throttled by a resetting frame timer", () => {
    const code = `
      import { useFrame } from "@react-three/fiber/webgpu";
      import { useRef, useState } from "react";
      const Scene = () => {
        const timerRef = useRef(0);
        const [, setDamages] = useState([]);
        useFrame((_, delta) => {
          timerRef.current += delta;
          if (timerRef.current > 0.3) {
            timerRef.current = 0;
            const nextDamage = createDamage();
            setDamages((damages) => [...damages, nextDamage]);
            setTimeout(() => setDamages((damages) => damages.slice(1)), 1500);
          }
        });
        return null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(0);
  });

  it("resolves timer aliases, static computed current, and reversed boundaries", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useRef as useTimerRef, useState } from "react";
      const Scene = ({ enabled }) => {
        const timerRef = useTimerRef(0);
        const elapsedRef = timerRef;
        const threshold = 0.3;
        const [, setPulse] = useState(0);
        useFrame((_, delta) => {
          elapsedRef.current += delta;
          if (enabled) {
            if (threshold <= elapsedRef["current"]) {
              elapsedRef.current = -1;
              setPulse((pulse) => pulse + 1);
            }
          }
        });
        return null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(0);
  });

  it("keeps unproven or still-triggering timer resets reportable", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useRef, useState } from "react";
      const Scene = ({ shouldReset }) => {
        const timerRef = useRef(0);
        const otherRef = useRef(0);
        const [, setCount] = useState(0);
        useFrame(() => {
          if (timerRef.current > 0.3) setCount(1);
          if (timerRef.current > 0.3) { otherRef.current = 0; setCount(2); }
          if (timerRef.current > 0.3) { timerRef.current = 1; setCount(3); }
          if (timerRef.current > 0.3) { timerRef.current = 0; timerRef.current = 1; setCount(4); }
          if (timerRef.current > 0.3) { setCount(5); timerRef.current = 0; }
          if (timerRef.current > 0.3) { if (shouldReset) timerRef.current = 0; setCount(6); }
          if (timerRef.current > 0.3) { for (const item of items) { timerRef.current = 0; setCount(item); } }
        });
        return null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(7);
  });

  it("allows mutually exclusive bounded state transitions", () => {
    const code = `
      import { useFrame, useThree } from "@react-three/fiber";
      import { useState } from "react";
      const Scene = () => {
        const camera = useThree((state) => state.camera);
        const [zoomIn, setZoomIn] = useState(true);
        useFrame(() => {
          zoomIn ? (camera.zoom += 0.01) : (camera.zoom -= 0.01);
          if (camera.zoom > 3) {
            setZoomIn(false);
          } else if (camera.zoom < 1) {
            setZoomIn(true);
          }
        });
        return null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(0);
  });

  it("allows bounded state transitions nested under an outer guard", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useState } from "react";
      const Scene = ({ enabled, elapsed }) => {
        const [active, setActive] = useState(false);
        useFrame(() => {
          if (enabled) {
            if (elapsed > 3) setActive(false);
            else if (elapsed < 1) setActive(true);
          }
        });
        return active ? <mesh /> : null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(0);
  });

  it("reports a non-boolean update inside a bounded transition chain", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useState } from "react";
      const Scene = ({ elapsed }) => {
        const [active, setActive] = useState(false);
        useFrame(() => {
          if (elapsed > 3) {
            setActive(readActive());
          } else if (elapsed < 1) {
            setActive(true);
          } else {
            setActive(false);
          }
        });
        return active ? <mesh /> : null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(3);
  });

  it("reports unrelated and repeated updates inside bounded transition chains", () => {
    const unrelatedResult = runRule(
      r3fNoStateInUseFrame,
      `import { useFrame } from "@react-three/fiber"; import { useState } from "react"; const Scene = ({ x, y }) => { const [, setActive] = useState(false); useFrame(() => { if (x > 3) setActive(true); else if (x < 1) setActive(true); else if (y > 4) setActive(false); }); return null; };`,
    );
    const repeatedResult = runRule(
      r3fNoStateInUseFrame,
      `import { useFrame } from "@react-three/fiber"; import { useState } from "react"; const Scene = ({ x }) => { const [, setActive] = useState(false); useFrame(() => { if (x > 3) { setActive(false); setActive(true); } else if (x < 1) setActive(true); }); return null; };`,
    );
    expect(unrelatedResult.diagnostics).toHaveLength(3);
    expect(repeatedResult.diagnostics).toHaveLength(3);
  });

  it("reports a one-sided relational state update", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useState } from "react";
      const Scene = ({ elapsed }) => {
        const [, setOpen] = useState(false);
        useFrame(() => {
          if (elapsed > 3) setOpen(true);
        });
        return null;
      };
    `;
    expect(runRule(r3fNoStateInUseFrame, code).diagnostics).toHaveLength(1);
  });
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

  it.each([
    `!started && setStarted(true);`,
    `started || setStarted(true);`,
    `started && setStarted(false);`,
    `!started || setStarted(false);`,
    `!started ? setStarted(true) : logStable();`,
    `started ? setStarted(false) : logStable();`,
  ])("allows converging boolean latch expressions", (transition) => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [started, setStarted] = useState(false); useFrame(() => { ${transition} }); return started; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `started && setStarted(true);`,
    `!started && setStarted(false);`,
    `started || setStarted(false);`,
    `!started || setStarted(true);`,
    `started && setStarted((value) => !value);`,
  ])("reports non-converging boolean latch expressions", (transition) => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [started, setStarted] = useState(false); useFrame(() => { ${transition} }); return started; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports updates outside a nested latch transition", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [started, setStarted] = useState(true); const [count, setCount] = useState(0); useFrame(() => { if (started) { setCount((value) => value + 1); if (done) setStarted(false); } }); return count; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows related updates inside the nested latch region", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [started, setStarted] = useState(true); const [finished, setFinished] = useState(false); useFrame(() => { if (started) { if (didFinish()) { setStarted(false); setFinished(true); } } }); return finished; };`,
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

  it("flags tuple-index state setters and their aliases", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const stateTuple = useState(0); const aliasedTuple = stateTuple; const updateCount = stateTuple[1]; useFrame(() => { stateTuple[1](1); aliasedTuple[1](2); updateCount(3); }); };`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not trust mutable or overwritten state and transition tuples", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useState, useTransition } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [, setCount] = useState(0); const stateTuple = useState(0); stateTuple[1] = scheduleLater; let mutableStateTuple = useState(0); const transitionTuple = useTransition(); transitionTuple[1] = scheduleLater; let mutableTransitionTuple = useTransition(); useFrame(() => { stateTuple[1](1); mutableStateTuple[1](2); transitionTuple[1](() => setCount(3)); mutableTransitionTuple[1](() => setCount(4)); }); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips definitely empty eager collections without silencing nonempty or unknown ones", () => {
    const emptyResult = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [, setCount] = useState(0); useFrame(() => { [].map(() => setCount(1)); new Set().forEach(() => setCount(2)); Array.from([], () => setCount(3)); }); };`,
    );
    const executableResult = runRule(
      r3fNoStateInUseFrame,
      `import { useState } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = ({ items }) => { const [, setCount] = useState(0); useFrame(() => { [1].map(() => setCount(1)); new Set([1]).forEach(() => setCount(2)); new Set(items).forEach(() => setCount(3)); Array.from(items, () => setCount(4)); }); };`,
    );
    expect(emptyResult.diagnostics).toHaveLength(0);
    expect(executableResult.diagnostics).toHaveLength(4);
  });

  it("flags state updates inside proven immediate React transitions", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { startTransition, useState, useTransition } from "react"; import { useFrame } from "@react-three/fiber"; const Scene = () => { const [, setCount] = useState(0); const transitionTuple = useTransition(); const aliasedTransitionTuple = transitionTuple; useFrame(() => { startTransition(() => setCount(1)); aliasedTransitionTuple[1](() => setCount(2)); }); };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust userland state hooks or transition names", () => {
    const result = runRule(
      r3fNoStateInUseFrame,
      `import { useFrame } from "@react-three/fiber"; const useState = () => [0, updateLater]; const startTransition = scheduleLater; const Scene = () => { const stateTuple = useState(); useFrame(() => { stateTuple[1](1); startTransition(() => stateTuple[1](2)); }); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
