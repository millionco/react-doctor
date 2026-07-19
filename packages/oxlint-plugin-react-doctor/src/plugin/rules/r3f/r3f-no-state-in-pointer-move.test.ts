import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoStateInPointerMove } from "./r3f-no-state-in-pointer-move.js";

describe("r3f-no-state-in-pointer-move", () => {
  it("requires an R3F pointer-event release", () => {
    expect(r3fNoStateInPointerMove.requires).toEqual(["r3f:3"]);
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
});
