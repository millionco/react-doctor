import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeGpuComputationValidVariableName } from "./three-gpu-computation-valid-variable-name.js";

describe("three-gpu-computation-valid-variable-name", () => {
  it.each([
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); computation.addVariable("texture-position", shader, texture);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); computation.addVariable("gl_Position", shader, texture);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); computation.addVariable("uniform", shader, texture);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); computation.addVariable("projectionMatrix", shader, texture);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); computation.addVariable("texturePosition", firstShader, firstTexture); computation.addVariable("texturePosition", secondShader, secondTexture);`,
  ])("reports invalid, colliding, and duplicate variable names", (code) => {
    expect(runRule(threeGpuComputationValidVariableName, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); computation.addVariable("texturePosition", shader, texture); computation.addVariable("textureVelocity", shader, texture);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const first = new GPUComputationRenderer(4, 4, renderer); const second = new GPUComputationRenderer(4, 4, renderer); first.addVariable("texturePosition", shader, texture); second.addVariable("texturePosition", shader, texture);`,
    `import { GPUComputationRenderer } from "three/addons/misc/GPUComputationRenderer.js"; const computation = new GPUComputationRenderer(4, 4, renderer); computation.addVariable(variableName, shader, texture);`,
    `class GPUComputationRenderer { addVariable() {} } const computation = new GPUComputationRenderer(); computation.addVariable("uniform", shader, texture);`,
  ])("keeps valid, separate, dynamic, and unrelated names quiet", (code) => {
    expect(runRule(threeGpuComputationValidVariableName, code).diagnostics).toHaveLength(0);
  });
});
