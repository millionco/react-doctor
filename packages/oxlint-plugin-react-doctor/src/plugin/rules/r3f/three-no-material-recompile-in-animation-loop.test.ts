import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoMaterialRecompileInAnimationLoop } from "./three-no-material-recompile-in-animation-loop.js";

describe("three-no-material-recompile-in-animation-loop", () => {
  it.each([
    `import { WebGLRenderer, MeshStandardMaterial } from "three";
     const renderer = new WebGLRenderer();
     const material = new MeshStandardMaterial();
     renderer.setAnimationLoop(() => { material.needsUpdate = true; });`,
    `import * as THREE from "three";
     const renderer = new THREE.WebGLRenderer();
     const material = new THREE.ShaderMaterial();
     const refresh = () => { material["needsUpdate"] = true; };
     const frame = () => { refresh(); renderer.render(scene, camera); requestAnimationFrame(frame); };
     requestAnimationFrame(frame);`,
  ])("reports a proven material recompilation in a Three animation loop", (code) => {
    expect(runRule(threeNoMaterialRecompileInAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { WebGLRenderer, Texture } from "three"; const renderer = new WebGLRenderer(); const texture = new Texture(); renderer.setAnimationLoop(() => { texture.needsUpdate = true; });`,
    `import { WebGLRenderer, MeshStandardMaterial } from "three"; const renderer = new WebGLRenderer(); const material = new MeshStandardMaterial(); material.needsUpdate = true; renderer.setAnimationLoop(() => {});`,
    `import { WebGLRenderer, MeshStandardMaterial } from "three"; const renderer = new WebGLRenderer(); let material = new MeshStandardMaterial(); renderer.setAnimationLoop(() => { material.needsUpdate = true; });`,
    `const renderer = createRenderer(); const material = createMaterial(); renderer.setAnimationLoop(() => { material.needsUpdate = true; });`,
    `import { WebGLRenderer, MeshStandardMaterial } from "three"; const renderer = new WebGLRenderer(); const material = new MeshStandardMaterial(); renderer.setAnimationLoop(() => { material.needsUpdate = false; });`,
    `import { WebGLRenderer, MeshStandardMaterial } from "three"; const renderer = new WebGLRenderer(); const material = new MeshStandardMaterial(); renderer.setAnimationLoop(() => { if (changed) material.needsUpdate = true; });`,
  ])("keeps non-material, one-time, mutable, unproven, and disabled writes quiet", (code) => {
    expect(runRule(threeNoMaterialRecompileInAnimationLoop, code).diagnostics).toHaveLength(0);
  });
});
