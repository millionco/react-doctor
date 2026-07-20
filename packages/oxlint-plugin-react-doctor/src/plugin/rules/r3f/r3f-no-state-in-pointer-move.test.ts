import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoStateInPointerMove } from "./r3f-no-state-in-pointer-move.js";

describe("r3f-no-state-in-pointer-move", () => {
  it("does not need an explicit R3F version gate", () => {
    expect(r3fNoStateInPointerMove.requires).toBeUndefined();
  });

  it("reports useState and useReducer updates on every pointer movement", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useReducer, useState } from "react";
       import "@react-three/fiber";
       const Scene = () => {
         const [point, setPoint] = useState(null);
         const [, dispatch] = useReducer(reducer, initial);
         return <mesh onPointerMove={(event) => { setPoint(event.point); dispatch({ type: "move" }); }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves stable setter aliases and React callback wrappers", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `const React = require("react");
       const Fiber = require("@react-three/fiber");
       const Scene = () => {
         const [, setPosition] = React.useState(null);
         const updatePosition = setPosition;
         const handler = React.useCallback((event) => updatePosition(event.point), [updatePosition]);
         return <mesh onPointerMove={handler} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows guarded semantic transitions and commit-time updates", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import "@react-three/fiber";
       const Scene = () => {
         const [hovered, setHovered] = useState(false);
         const [position, setPosition] = useState(null);
         return <mesh
           onPointerMove={(event) => { if (hovered !== event.isOver) setHovered(event.isOver); }}
           onPointerUp={(event) => setPosition(event.point)}
         />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a short-circuit boolean latch transition", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import "@react-three/fiber";
       const Scene = () => {
         const [started, setStarted] = useState(false);
         return <mesh onPointerMove={() => { !started && setStarted(true); }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows primitive buckets derived from discrete pointer-hit indices", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import "@react-three/fiber";
       const Scene = () => {
         const [, setHoveredFace] = useState(0);
         const [, setInstanceGroup] = useState(0);
         const [, setBatch] = useState(0);
         return <>
           <instancedMesh onPointerMove={(event) => {
             setHoveredFace(Math.floor((event.faceIndex || 0) / 2));
             const { instanceId: hitInstance = 0 } = event;
             const instanceGroup = Math.trunc(hitInstance / 10);
             setInstanceGroup(instanceGroup);
           }} />
           <batchedMesh onPointerMove={(event) => (event.stopPropagation(), setBatch(event.batchId))} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports quantized continuous coordinates and unproven quantizers", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import "@react-three/fiber";
       const Math = { floor: quantize };
       const Scene = () => {
         const [, setWorldBucket] = useState(0);
         const [, setScreenBucket] = useState(0);
         const [, setFace] = useState(0);
         return <mesh onPointerMove={(event) => {
           setWorldBucket(globalThis.Math.floor(event.point.x / 2));
           setScreenBucket(globalThis.Math.round(event.clientX / 100));
           setFace(Math.floor((event.faceIndex || 0) / 2));
         }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports global Math quantization when any input remains continuous or unknown", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import "@react-three/fiber";
       const Scene = ({ bucketSize }) => {
         const [, setWorldBucket] = useState(0);
         const [, setFaceBucket] = useState(0);
         return <mesh onPointerMove={(event) => {
           setWorldBucket(Math.floor(event.point.x / 2));
           setFaceBucket(Math.floor((event.faceIndex || 0) / bucketSize));
         }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports fresh payloads and toggles that contain a bounded face bucket", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import "@react-three/fiber";
       const Scene = () => {
         const [, setHover] = useState({ face: 0 });
         const [, setOpen] = useState(false);
         return <mesh onPointerMove={(event) => {
           setHover({ face: Math.floor((event.faceIndex || 0) / 2) });
           setOpen((open) => !open);
         }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports a non-converging short-circuit state update", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import "@react-three/fiber";
       const Scene = () => {
         const [started, setStarted] = useState(false);
         return <mesh onPointerMove={() => { started && setStarted(true); }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores DOM, imported handlers, unknown spreads, and unrelated setters", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import "@react-three/fiber";
       import { handler } from "./handler";
       const Scene = () => {
         const [, setPoint] = useState(null);
         return <>
           <div onPointerMove={() => setPoint(null)} />
           <mesh onPointerMove={handler} />
           <mesh onPointerMove={() => setPoint(null)} {...props} />
           <mesh onPointerMove={() => localSetter()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags tuple-index setters and updates inside flushSync", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import { useState } from "react";
       import { flushSync } from "react-dom";
       import "@react-three/fiber";
       const Scene = () => {
         const pointState = useState(null);
         return <mesh onPointerMove={(event) => { pointState[1](event.point); flushSync(() => pointState[1](event.point)); }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust userland tuple hooks or flushSync names", () => {
    const result = runRule(
      r3fNoStateInPointerMove,
      `import "@react-three/fiber";
       const useState = () => [null, updateLater];
       const flushSync = scheduleLater;
       const Scene = () => {
         const pointState = useState();
         return <mesh onPointerMove={() => { pointState[1](point); flushSync(() => pointState[1](point)); }} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
