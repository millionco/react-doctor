import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeWebgpuNoHighPrecisionInstancing } from "./three-webgpu-no-high-precision-instancing.js";

const settings = { capabilities: ["three:181"] };

describe("three-webgpu-no-high-precision-instancing", () => {
  it.each([
    `import { WebGPURenderer, Scene, InstancedMesh } from "three/webgpu"; const renderer = new WebGPURenderer(); renderer.highPrecision = true; const scene = new Scene(); const mesh = new InstancedMesh(geometry, material, 10); scene.add(mesh); renderer.render(scene, camera);`,
    `import * as THREE from "three/webgpu"; const renderer = new THREE.WebGPURenderer(); renderer.highPrecision = true; const mesh = new THREE.SkinnedMesh(geometry, material); renderer.render(mesh, camera);`,
  ])("reports incompatible high-precision rendering", (code) => {
    expect(
      runRule(threeWebgpuNoHighPrecisionInstancing, code, { settings }).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    `import { WebGPURenderer, Scene, InstancedMesh } from "three/webgpu"; const renderer = new WebGPURenderer(); renderer.highPrecision = false; const scene = new Scene(); scene.add(new InstancedMesh(geometry, material, 10)); renderer.render(scene, camera);`,
    `import { WebGPURenderer, Scene, InstancedMesh } from "three/webgpu"; const renderer = new WebGPURenderer(); renderer.highPrecision = true; const first = new Scene(); const second = new Scene(); first.add(new InstancedMesh(geometry, material, 10)); renderer.render(second, camera);`,
    `import { WebGPURenderer, Scene, Mesh } from "three/webgpu"; const renderer = new WebGPURenderer(); renderer.highPrecision = true; const scene = new Scene(); scene.add(new Mesh(geometry, material)); renderer.render(scene, camera);`,
    `class WebGPURenderer {} class InstancedMesh {} const renderer = new WebGPURenderer(); renderer.highPrecision = true; renderer.render(new InstancedMesh());`,
  ])("keeps compatible, unrelated-scene, and non-Three use quiet", (code) => {
    expect(
      runRule(threeWebgpuNoHighPrecisionInstancing, code, { settings }).diagnostics,
    ).toHaveLength(0);
  });
});
