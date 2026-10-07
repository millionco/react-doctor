import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeWebgpuRequireInitBeforeSyncOperation } from "./three-webgpu-require-init-before-sync-operation.js";

const settings = { capabilities: ["three:181"] };

describe("three-webgpu-require-init-before-sync-operation", () => {
  it.each([
    `import { WebGPURenderer } from "three/webgpu"; const start = async () => { const renderer = new WebGPURenderer(); renderer.render(scene, camera); };`,
    `import * as THREE from "three/webgpu"; const start = async () => { const renderer = new THREE.WebGPURenderer(); if (ready) await renderer.init(); renderer.clear(); };`,
    `const { WebGPURenderer } = require("three/webgpu"); const start = async () => { const renderer = new WebGPURenderer(); renderer.initTexture(texture); };`,
  ])("reports synchronous operations before an unconditional awaited init", (code) => {
    expect(
      runRule(threeWebgpuRequireInitBeforeSyncOperation, code, { settings }).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    `import { WebGPURenderer } from "three/webgpu"; const start = async () => { const renderer = new WebGPURenderer(); await renderer.init(); renderer.render(scene, camera); };`,
    `import { WebGPURenderer } from "three/webgpu"; const renderer = new WebGPURenderer(); renderer.renderAsync(scene, camera);`,
    `import { WebGPURenderer } from "three/webgpu"; const renderer = new WebGPURenderer(); renderer.setAnimationLoop(() => renderer.render(scene, camera));`,
    `import { WebGPURenderer } from "three/webgpu"; const renderer = new WebGPURenderer(); const render = () => renderer.render(scene, camera); initialize(renderer).then(render);`,
    `class WebGPURenderer { render() {} } const renderer = new WebGPURenderer(); renderer.render();`,
  ])(
    "keeps initialized, self-initializing async, nested, delegated, and unrelated use quiet",
    (code) => {
      expect(
        runRule(threeWebgpuRequireInitBeforeSyncOperation, code, { settings }).diagnostics,
      ).toHaveLength(0);
    },
  );
});
