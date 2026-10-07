import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireFrameDelta } from "./three-require-frame-delta.js";

describe("three-require-frame-delta", () => {
  it.each([
    `import { Mesh, WebGLRenderer } from "three";
     const renderer = new WebGLRenderer(); const mesh = new Mesh();
     renderer.setAnimationLoop(() => { mesh.rotation.y += 0.01; });`,
    `import * as THREE from "three";
     const renderer = new THREE.WebGLRenderer(); const mesh = new THREE.Mesh();
     renderer.setAnimationLoop(() => { mesh.position.x++; });`,
    `import { Mesh, WebGLRenderer } from "three";
     const renderer = new WebGLRenderer(); const mesh = new Mesh(); const target = new Mesh();
     renderer.setAnimationLoop(() => { mesh.position.lerp(target.position, 0.1); });`,
    `import { MathUtils, WebGLRenderer } from "three";
     const renderer = new WebGLRenderer();
     renderer.setAnimationLoop(() => { opacity = MathUtils.lerp(opacity, targetOpacity, 0.1); });`,
  ])("flags fixed per-frame Three.js transform changes", (code) => {
    expect(runRule(threeRequireFrameDelta, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Clock, Mesh, WebGLRenderer } from "three";
     const renderer = new WebGLRenderer(); const mesh = new Mesh(); const clock = new Clock();
     renderer.setAnimationLoop(() => { mesh.rotation.y += speed * clock.getDelta(); });`,
    `import { Clock, Mesh, WebGLRenderer } from "three";
     const renderer = new WebGLRenderer(); const mesh = new Mesh(); const clock = new Clock();
     renderer.setAnimationLoop(() => { const delta = clock.getDelta(); mesh.position.x += speed * delta; });`,
    `import { Mesh, WebGLRenderer } from "three";
     const renderer = new WebGLRenderer(); const mesh = new Mesh();
     renderer.setAnimationLoop((time) => { mesh.rotation.y = time * 0.001; });`,
    `import { Mesh, WebGLRenderer } from "three";
     const renderer = new WebGLRenderer(); const mesh = new Mesh();
     renderer.setAnimationLoop(() => { if (didPointerMove) mesh.rotation.y += 0.01; });`,
    `const renderer = createRenderer(); const mesh = createMesh();
     renderer.setAnimationLoop(() => { mesh.rotation.y += 0.01; });`,
  ])("allows delta-aware, absolute-time, conditional, or unproven animation", (code) => {
    expect(runRule(threeRequireFrameDelta, code).diagnostics).toHaveLength(0);
  });
});
