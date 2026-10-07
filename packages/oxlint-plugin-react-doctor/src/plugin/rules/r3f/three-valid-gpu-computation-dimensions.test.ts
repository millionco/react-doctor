import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidGpuComputationDimensions } from "./three-valid-gpu-computation-dimensions.js";

describe("three-valid-gpu-computation-dimensions", () => {
  it.each([
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; new GPUComputationRenderer(0, 8, renderer);`,
    `import * as Addons from "three/addons"; new Addons.GPUComputationRenderer(8, -1, renderer);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; new GPUComputationRenderer(4.5, 8, renderer);`,
  ])("reports invalid static computation dimensions", (code) => {
    expect(runRule(threeValidGpuComputationDimensions, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; new GPUComputationRenderer(8, 8, renderer);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; new GPUComputationRenderer(width, height, renderer);`,
    `class GPUComputationRenderer {} new GPUComputationRenderer(0, 0, renderer);`,
  ])("keeps valid, dynamic, and unrelated dimensions quiet", (code) => {
    expect(runRule(threeValidGpuComputationDimensions, code).diagnostics).toHaveLength(0);
  });
});
