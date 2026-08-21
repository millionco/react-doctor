import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeGpuComputationHandleInitError } from "./three-gpu-computation-handle-init-error.js";

describe("three-gpu-computation-handle-init-error", () => {
  it.each([
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(64, 64, renderer); computation.init();`,
    `import * as Misc from "three/examples/jsm/misc/GPUComputationRenderer.js"; const computation = new Misc.GPUComputationRenderer(64, 64, renderer); void computation.init();`,
  ])("reports discarded initialization results", (code) => {
    expect(runRule(threeGpuComputationHandleInitError, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(64, 64, renderer); const error = computation.init(); if (error !== null) throw new Error(error);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(64, 64, renderer); if (computation.init()) disableSimulation();`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(64, 64, renderer); return computation.init();`,
    `class GPUComputationRenderer { init() {} } const computation = new GPUComputationRenderer(); computation.init();`,
  ])("keeps observed, propagated, and unrelated results quiet", (code) => {
    expect(runRule(threeGpuComputationHandleInitError, code).diagnostics).toHaveLength(0);
  });
});
