import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoObjectPointerCapture } from "./r3f-no-object-pointer-capture.js";

describe("r3f-no-object-pointer-capture", () => {
  it("reports capture methods on object and eventObject", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const scene = <mesh onPointerDown={(event) => {
         event.object.setPointerCapture(event.pointerId);
         event.eventObject["releasePointerCapture"](event.pointerId);
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("follows stable object aliases in referenced handlers", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const handlePointer = (event) => {
         const hitObject = event.object;
         hitObject.hasPointerCapture(event.pointerId);
       };
       const scene = <group onPointerMove={handlePointer} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports capture methods on destructured event objects", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const direct = <mesh onPointerDown={({ object }) => object.setPointerCapture(1)} />;
       const renamed = <mesh onPointerDown={({ eventObject: hitObject }) => hitObject.releasePointerCapture(1)} />;
       const local = <mesh onPointerDown={(event) => { const { object } = event; object.hasPointerCapture(1); }} />;
       const aliasedEvent = <mesh onPointerDown={(event) => { const pointerEvent = event; const { eventObject: hitObject } = pointerEvent; hitObject.setPointerCapture(1); }} />;
       const computedMember = <mesh onPointerDown={(event) => { const hitObject = event["object"]; hitObject.releasePointerCapture(1); }} />;
       const computedDestructure = <mesh onPointerDown={(event) => { const { ["eventObject"]: hitObject } = event; hitObject.setPointerCapture(1); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(6);
  });

  it("resolves pointer handlers wrapped by CommonJS React useCallback", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `const Fiber = require("@react-three/fiber");
       const React = require("react");
       const handlePointer = React.useCallback((event) => event.object.setPointerCapture(event.pointerId), []);
       const scene = <mesh onPointerDown={handlePointer} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes the R3F line intrinsic despite its SVG name collision", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const scene = <line onPointerDown={(event) => event.object.setPointerCapture(event.pointerId)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects pointer-handler JSX spread authority", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const badHandler = (event) => event.object.setPointerCapture(event.pointerId);
       const scene = <><mesh onPointerDown={badHandler} {...props} /><mesh {...props} onPointerDown={badHandler} /><mesh onPointerDown={badHandler} {...{ visible: true }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows capture methods on target and currentTarget", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const scene = <mesh onPointerDown={(event) => {
         event.target.setPointerCapture(event.pointerId);
         event.currentTarget.releasePointerCapture(event.pointerId);
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores destructured objects from unrelated values", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const scene = <mesh onPointerDown={(event) => { const { object } = otherEvent; object.setPointerCapture(1); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores reassigned destructured parameter objects", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const scene = <mesh onPointerDown={({ object }) => { object = domTarget; object.setPointerCapture(1); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores DOM handlers and files without R3F provenance", () => {
    const result = runRule(
      r3fNoObjectPointerCapture,
      `import { Canvas } from "@react-three/fiber";
       const dom = <div onPointerDown={(event) => event.object.setPointerCapture(1)} />;
       const custom = <Mesh onPointerDown={(event) => event.object.setPointerCapture(1)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
