import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireRenderTargetReset } from "./three-require-render-target-reset.js";

describe("three-require-render-target-reset", () => {
  it.each([
    `import { WebGLRenderer, WebGLRenderTarget } from "three";
     const renderer = new WebGLRenderer();
     const target = new WebGLRenderTarget(256, 256);
     const render = () => { renderer.setRenderTarget(target); renderer.render(scene, camera); };`,
    `import * as THREE from "three";
     const renderer = new THREE.WebGLRenderer();
     const target = new THREE.WebGLCubeRenderTarget(256);
     const render = () => {
       renderer.setRenderTarget(target);
       if (restore) renderer.setRenderTarget(null);
     };`,
  ])("reports missing target resets", (code) => {
    expect(runRule(threeRequireRenderTargetReset, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { WebGLRenderer, WebGLRenderTarget } from "three";
     const renderer = new WebGLRenderer();
     const target = new WebGLRenderTarget(256, 256);
     const render = () => {
       renderer.setRenderTarget(target);
       renderer.render(scene, camera);
       renderer.setRenderTarget(null);
     };`,
    `import { WebGLRenderer, WebGLRenderTarget } from "three";
     import { restoreRenderer } from "./renderer";
     const renderer = new WebGLRenderer();
     const target = new WebGLRenderTarget(256, 256);
     const render = () => { renderer.setRenderTarget(target); restoreRenderer(renderer); };`,
    `const renderer = createRenderer(); const target = createTarget(); renderer.setRenderTarget(target);`,
    `import { WebGLRenderer } from "three";
     const renderer = new WebGLRenderer();
     renderer.setRenderTarget(dynamicTarget);`,
  ])("allows covered, delegated, and unproven target changes", (code) => {
    expect(runRule(threeRequireRenderTargetReset, code).diagnostics).toHaveLength(0);
  });
});
