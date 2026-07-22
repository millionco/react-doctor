import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoAllocationInPointerMove } from "./three-no-allocation-in-pointer-move.js";

describe("three-no-allocation-in-pointer-move", () => {
  it.each([
    `import { Vector2 } from "three"; const View = () => <canvas onPointerMove={() => new Vector2()} />;`,
    `import { WebGLRenderer, Raycaster } from "three"; const renderer = new WebGLRenderer(); const move = () => new Raycaster(); renderer.domElement.addEventListener("pointermove", move);`,
    `import { WebGLRenderer, Vector3 } from "three"; const renderer = new WebGLRenderer(); const point = new Vector3(); renderer.domElement.addEventListener("pointermove", () => point.clone());`,
  ])("flags direct Three.js allocations during pointer movement", (code) => {
    expect(runRule(threeNoAllocationInPointerMove, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Vector2 } from "three"; const View = () => <div onPointerMove={() => new Vector2()} />;`,
    `import { Vector2 } from "three"; const View = () => <canvas onPointerMove={() => { if (active) new Vector2(); }} />;`,
    `import { WebGLRenderer } from "other"; const renderer = new WebGLRenderer(); renderer.domElement.addEventListener("pointermove", () => new Thing());`,
    `import { WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); renderer.domElement.addEventListener("click", () => new Thing());`,
  ])("ignores unrelated, conditional, or discrete work", (code) => {
    expect(runRule(threeNoAllocationInPointerMove, code).diagnostics).toHaveLength(0);
  });
});
