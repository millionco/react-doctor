import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeWebgpuNoLegacyEffectComposer } from "./three-webgpu-no-legacy-effect-composer.js";

describe("three-webgpu-no-legacy-effect-composer", () => {
  it.each([
    `import { WebGPURenderer } from "three/webgpu"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const renderer = new WebGPURenderer(); const composer = new EffectComposer(renderer);`,
    `import * as THREE from "three/webgpu"; import { EffectComposer as Composer } from "three/examples/jsm/postprocessing/EffectComposer.js"; const renderer = new THREE.WebGPURenderer(); new Composer(renderer);`,
  ])("flags legacy EffectComposer with WebGPURenderer", (code) => {
    expect(runRule(threeWebgpuNoLegacyEffectComposer, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { WebGLRenderer } from "three"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const renderer = new WebGLRenderer(); new EffectComposer(renderer);`,
    `import { WebGPURenderer } from "three/webgpu"; import { EffectComposer } from "other"; const renderer = new WebGPURenderer(); new EffectComposer(renderer);`,
    `import { WebGPURenderer } from "other"; import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"; const renderer = new WebGPURenderer(); new EffectComposer(renderer);`,
  ])("allows WebGL and unproven lookalikes", (code) => {
    expect(runRule(threeWebgpuNoLegacyEffectComposer, code).diagnostics).toHaveLength(0);
  });
});
