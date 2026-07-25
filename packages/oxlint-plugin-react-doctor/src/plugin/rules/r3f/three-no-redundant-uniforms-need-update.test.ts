import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoRedundantUniformsNeedUpdate } from "./three-no-redundant-uniforms-need-update.js";

describe("three-no-redundant-uniforms-need-update", () => {
  it.each([
    `import { WebGLRenderer, ShaderMaterial } from "three";
     const renderer = new WebGLRenderer();
     const material = new ShaderMaterial();
     renderer.setAnimationLoop(() => { material.uniformsNeedUpdate = true; });`,
    `import * as THREE from "three";
     const renderer = new THREE.WebGLRenderer();
     const material = new THREE.RawShaderMaterial();
     renderer.setAnimationLoop(() => { material.uniformsNeedUpdate = true; });`,
  ])("reports redundant ShaderMaterial uniform update flags", (code) => {
    expect(runRule(threeNoRedundantUniformsNeedUpdate, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { WebGLRenderer, MeshStandardMaterial } from "three"; const renderer = new WebGLRenderer(); const material = new MeshStandardMaterial(); renderer.setAnimationLoop(() => { material.uniformsNeedUpdate = true; });`,
    `import { WebGLRenderer, ShaderMaterial } from "three"; const renderer = new WebGLRenderer(); const material = new ShaderMaterial(); material.uniformsNeedUpdate = true; renderer.setAnimationLoop(() => {});`,
    `import { WebGLRenderer, ShaderMaterial } from "three"; const renderer = new WebGLRenderer(); const material = new ShaderMaterial(); renderer.setAnimationLoop(() => { material.uniformsNeedUpdate = false; });`,
    `import * as THREE from "three"; const renderer = new THREE.WebGLRenderer(); const material = new THREE.RawShaderMaterial(); renderer.setAnimationLoop(() => { if (changed) material["uniformsNeedUpdate"] = true; });`,
    `import { WebGLRenderer, ShaderMaterial } from "three"; const renderer = new WebGLRenderer(); const material = new ShaderMaterial(); renderer.setAnimationLoop(() => { if (changed) material.uniformsNeedUpdate = true; });`,
    `const renderer = createRenderer(); const material = createMaterial(); renderer.setAnimationLoop(() => { material.uniformsNeedUpdate = true; });`,
  ])("keeps other materials, one-time, disabled, and unproven writes quiet", (code) => {
    expect(runRule(threeNoRedundantUniformsNeedUpdate, code).diagnostics).toHaveLength(0);
  });
});
