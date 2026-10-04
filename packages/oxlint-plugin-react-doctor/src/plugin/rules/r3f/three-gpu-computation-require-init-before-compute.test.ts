import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeGpuComputationRequireInitBeforeCompute } from "./three-gpu-computation-require-init-before-compute.js";

describe("three-gpu-computation-require-init-before-compute", () => {
  it.each([
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); computation.compute();`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const start = () => { const computation = new GPUComputationRenderer(4, 4, renderer); if (ready) computation.init(); computation.compute(); };`,
    `import { WebGLRenderer } from "three"; import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const renderer = new WebGLRenderer(); const computation = new GPUComputationRenderer(4, 4, renderer); renderer.setAnimationLoop(() => { computation.compute(); renderer.render(scene, camera); });`,
    `import { WebGLRenderer } from "three"; import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const renderer = new WebGLRenderer(); const computation = new GPUComputationRenderer(4, 4, renderer); renderer.setAnimationLoop(() => { computation.compute(); renderer.render(scene, camera); }); computation.init();`,
  ])("reports compute paths without dominating initialization", (code) => {
    expect(runRule(threeGpuComputationRequireInitBeforeCompute, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); const error = computation.init(); computation.compute();`,
    `import { WebGLRenderer } from "three"; import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const renderer = new WebGLRenderer(); const computation = new GPUComputationRenderer(4, 4, renderer); const error = computation.init(); renderer.setAnimationLoop(() => { computation.compute(); renderer.render(scene, camera); });`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const first = new GPUComputationRenderer(4, 4, renderer); const second = new GPUComputationRenderer(4, 4, renderer); first.init(); first.compute();`,
    `class GPUComputationRenderer { init() {} compute() {} } const computation = new GPUComputationRenderer(); computation.compute();`,
  ])("keeps initialized, separate, and unrelated computations quiet", (code) => {
    expect(runRule(threeGpuComputationRequireInitBeforeCompute, code).diagnostics).toHaveLength(0);
  });
});
