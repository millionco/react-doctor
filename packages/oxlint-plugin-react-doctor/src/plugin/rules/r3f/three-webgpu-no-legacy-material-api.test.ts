import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeWebgpuNoLegacyMaterialApi } from "./three-webgpu-no-legacy-material-api.js";

describe("three-webgpu-no-legacy-material-api", () => {
  it.each([
    `import { WebGPURenderer, ShaderMaterial } from "three/webgpu"; const renderer = new WebGPURenderer(); const material = new ShaderMaterial();`,
    `import { WebGPURenderer } from "three/webgpu"; import { RawShaderMaterial } from "three"; const renderer = new WebGPURenderer(); new RawShaderMaterial();`,
    `import { WebGPURenderer, MeshStandardMaterial } from "three/webgpu"; const renderer = new WebGPURenderer(); const material = new MeshStandardMaterial(); material.onBeforeCompile = patch;`,
  ])("flags unsupported material APIs with WebGPURenderer", (code) => {
    expect(runRule(threeWebgpuNoLegacyMaterialApi, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { WebGLRenderer, ShaderMaterial } from "three"; const renderer = new WebGLRenderer(); new ShaderMaterial();`,
    `import { WebGPURenderer, MeshStandardNodeMaterial } from "three/webgpu"; const renderer = new WebGPURenderer(); new MeshStandardNodeMaterial();`,
    `import { WebGPURenderer } from "three/webgpu"; const renderer = new WebGPURenderer(); unknown.onBeforeCompile = patch;`,
    `import { WebGPURenderer } from "other"; import { ShaderMaterial } from "three"; const renderer = new WebGPURenderer(); new ShaderMaterial();`,
  ])("allows supported node materials and unproven renderers or receivers", (code) => {
    expect(runRule(threeWebgpuNoLegacyMaterialApi, code).diagnostics).toHaveLength(0);
  });
});
