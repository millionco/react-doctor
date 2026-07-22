import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoNewInAnimationLoop } from "./three-no-new-in-animation-loop.js";

describe("three-no-new-in-animation-loop", () => {
  it("flags allocations inside a Three.js setAnimationLoop callback", () => {
    const result = runRule(
      threeNoNewInAnimationLoop,
      `import { WebGLRenderer as Renderer } from "three";
       const renderer = new Renderer();
       renderer.setAnimationLoop(() => { const position = new Vector3(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags allocations inside a recursive RAF loop that renders with Three.js", () => {
    const result = runRule(
      threeNoNewInAnimationLoop,
      `import * as THREE from "three";
       const renderer = new THREE.WebGLRenderer();
       const frame = () => {
         const matrix = new Matrix4();
         renderer.render(scene, camera);
         requestAnimationFrame(frame);
       };
       requestAnimationFrame(frame);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows unconditionally called local helpers", () => {
    const result = runRule(
      threeNoNewInAnimationLoop,
      `import { WebGLRenderer } from "three";
       const renderer = new WebGLRenderer();
       const allocate = () => new Vector3();
       renderer.setAnimationLoop(() => allocate());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores conditional allocations", () => {
    const result = runRule(
      threeNoNewInAnimationLoop,
      `import { WebGLRenderer } from "three";
       const renderer = new WebGLRenderer();
       renderer.setAnimationLoop(() => { if (needsResize) new BufferGeometry(); });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `const renderer = createRenderer(); renderer.setAnimationLoop(() => new Vector3());`,
    `import { WebGLRenderer } from "other-renderer"; const renderer = new WebGLRenderer(); renderer.setAnimationLoop(() => new Vector3());`,
    `import { WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); requestAnimationFrame(() => new Vector3());`,
  ])("ignores unproven Three.js animation loops", (code) => {
    expect(runRule(threeNoNewInAnimationLoop, code).diagnostics).toHaveLength(0);
  });
});
