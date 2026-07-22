import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoStateInPointerMove } from "./three-no-state-in-pointer-move.js";

describe("three-no-state-in-pointer-move", () => {
  it.each([
    `import { useState } from "react"; import { Vector2 } from "three"; const pointer = new Vector2(); const View = () => { const [, setPoint] = useState(null); return <canvas onPointerMove={(event) => { pointer.set(event.clientX, event.clientY); setPoint(event.clientX); }} />; };`,
    `import { useState } from "react"; import { WebGLRenderer } from "three"; const View = () => { const [, setPoint] = useState(null); const renderer = new WebGLRenderer(); renderer.domElement.addEventListener("pointermove", () => setPoint(Date.now())); return <canvas />; };`,
  ])("flags React state writes in direct Three.js pointer handlers", (code) => {
    expect(runRule(threeNoStateInPointerMove, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { useState } from "react"; import { Vector2 } from "three"; const pointer = new Vector2(); const View = ({ active, previous }) => { const [, setActive] = useState(active); return <canvas onPointerMove={() => { pointer.x++; if (active !== previous) setActive(active); }} />; };`,
    `import { useState } from "react"; const View = () => { const [, setPoint] = useState(null); return <canvas onPointerMove={(event) => setPoint(event.clientX)} />; };`,
    `import { useState } from "react"; import "three"; const View = () => { const [, setPoint] = useState(null); return <div onPointerMove={() => setPoint(null)} />; };`,
    `const setPoint = () => {}; const View = () => <canvas onPointerMove={() => setPoint(null)} />;`,
  ])("allows guarded transitions and unrelated handlers or setters", (code) => {
    expect(runRule(threeNoStateInPointerMove, code).diagnostics).toHaveLength(0);
  });
});
