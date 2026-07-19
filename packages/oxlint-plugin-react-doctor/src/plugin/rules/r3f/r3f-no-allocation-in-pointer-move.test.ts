import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoAllocationInPointerMove } from "./r3f-no-allocation-in-pointer-move.js";

describe("r3f-no-allocation-in-pointer-move", () => {
  it("reports constructors and proven Three.js event clones", () => {
    const result = runRule(
      r3fNoAllocationInPointerMove,
      `import { Canvas } from "@react-three/fiber";
       import { Vector3 } from "three";
       const scene = <mesh onPointerMove={(event) => {
         const first = new Vector3();
         const second = event.point.clone();
         const third = event.object.position.clone();
         consume(first, second, third);
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports clones of shared ray, uv, and normal event data", () => {
    const result = runRule(
      r3fNoAllocationInPointerMove,
      `import { Canvas } from "@react-three/fiber";
       const scene = <mesh onPointerMove={(event) => {
         consume(event.ray.clone(), event.uv.clone(), event.normal.clone());
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows reused objects and conditionally executed allocations", () => {
    const result = runRule(
      r3fNoAllocationInPointerMove,
      `import { Canvas } from "@react-three/fiber";
       import { Vector3 } from "three";
       const scratch = new Vector3();
       const scene = <mesh onPointerMove={(event) => {
         scratch.copy(event.point);
         if (didPointerTargetChange) cache.current = event.point.clone();
         enabled && new Vector3();
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves local handlers and React callback wrappers", () => {
    const result = runRule(
      r3fNoAllocationInPointerMove,
      `const Fiber = require("@react-three/fiber");
       const React = require("react");
       const handler = React.useCallback(({ point }) => point.clone(), []);
       const scene = <mesh onPointerMove={handler} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores DOM handlers, imported handlers, and unrelated clone methods", () => {
    const result = runRule(
      r3fNoAllocationInPointerMove,
      `import { Canvas } from "@react-three/fiber";
       import { handler } from "./handler";
       const dom = <div onPointerMove={() => new Thing()} />;
       const imported = <mesh onPointerMove={handler} />;
       const unrelated = <mesh onPointerMove={(event) => { userValue.clone(); event.camera.clone(); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
