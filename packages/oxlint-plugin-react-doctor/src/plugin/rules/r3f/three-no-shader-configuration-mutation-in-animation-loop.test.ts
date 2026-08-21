import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoShaderConfigurationMutationInAnimationLoop } from "./three-no-shader-configuration-mutation-in-animation-loop.js";

describe("three-no-shader-configuration-mutation-in-animation-loop", () => {
  it.each([
    `import { ShaderMaterial, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const material = new ShaderMaterial(); renderer.setAnimationLoop(() => { material.fragmentShader = buildShader(); renderer.render(scene, camera); });`,
    `import * as THREE from "three"; const renderer = new THREE.WebGLRenderer(); const material = new THREE.RawShaderMaterial(); renderer.setAnimationLoop(() => { material.defines.MODE = frame; renderer.render(scene, camera); });`,
    `import { ShaderMaterial, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const material = new ShaderMaterial(); renderer.setAnimationLoop(() => { material.uniforms = { time: { value: performance.now() } }; renderer.render(scene, camera); });`,
  ])("reports unconditional shader configuration writes in animation loops", (code) => {
    expect(
      runRule(threeNoShaderConfigurationMutationInAnimationLoop, code).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    `import { ShaderMaterial, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const material = new ShaderMaterial({ uniforms: { time: { value: 0 } } }); renderer.setAnimationLoop(() => { material.uniforms.time.value += 1; renderer.render(scene, camera); });`,
    `import { ShaderMaterial, WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); const material = new ShaderMaterial(); renderer.setAnimationLoop(() => { if (changed) material.defines.MODE = mode; renderer.render(scene, camera); });`,
    `import { ShaderMaterial } from "three"; const material = new ShaderMaterial(); material.fragmentShader = source;`,
    `class ShaderMaterial {}; const material = new ShaderMaterial(); material.fragmentShader = source;`,
  ])("keeps uniform values, guarded, one-time, and unrelated writes quiet", (code) => {
    expect(
      runRule(threeNoShaderConfigurationMutationInAnimationLoop, code).diagnostics,
    ).toHaveLength(0);
  });
});
