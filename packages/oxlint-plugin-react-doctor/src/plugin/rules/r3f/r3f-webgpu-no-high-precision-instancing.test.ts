import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuNoHighPrecisionInstancing } from "./r3f-webgpu-no-high-precision-instancing.js";

const settings = { capabilities: ["three:181"] };

describe("r3f-webgpu-no-high-precision-instancing", () => {
  it.each([
    `import { Canvas } from "@react-three/fiber"; import { WebGPURenderer } from "three/webgpu"; const createRenderer = async () => { const renderer = new WebGPURenderer(); renderer.highPrecision = true; await renderer.init(); return renderer; }; export const Scene = () => <Canvas gl={createRenderer}><instancedMesh args={[geometry, material, 10]} /></Canvas>;`,
    `import { Canvas } from "@react-three/fiber"; import * as THREE from "three/webgpu"; export const Scene = () => <Canvas gl={async () => { const renderer = new THREE.WebGPURenderer(); renderer.highPrecision = true; await renderer.init(); return renderer; }}><skinnedMesh /></Canvas>;`,
  ])("reports incompatible high-precision Canvas descendants", (code) => {
    expect(
      runRule(r3fWebgpuNoHighPrecisionInstancing, code, { settings }).diagnostics,
    ).toHaveLength(1);
  });

  it.each([
    `import { Canvas } from "@react-three/fiber"; import { WebGPURenderer } from "three/webgpu"; export const Scene = () => <Canvas gl={async () => { const renderer = new WebGPURenderer(); renderer.highPrecision = false; await renderer.init(); return renderer; }}><instancedMesh /></Canvas>;`,
    `import { Canvas } from "@react-three/fiber"; import { WebGLRenderer } from "three"; export const Scene = () => <Canvas gl={() => new WebGLRenderer()}><instancedMesh /></Canvas>;`,
    `import { Canvas } from "other"; import { WebGPURenderer } from "three/webgpu"; export const Scene = () => <Canvas gl={() => { const renderer = new WebGPURenderer(); renderer.highPrecision = true; return renderer; }}><instancedMesh /></Canvas>;`,
    `import { Canvas } from "@react-three/fiber"; import { WebGPURenderer } from "three/webgpu"; export const Scene = () => <Canvas gl={() => { const renderer = new WebGPURenderer(); renderer.highPrecision = true; return renderer; }}><mesh /></Canvas>;`,
  ])("keeps compatible and unrelated Canvas trees quiet", (code) => {
    expect(
      runRule(r3fWebgpuNoHighPrecisionInstancing, code, { settings }).diagnostics,
    ).toHaveLength(0);
  });
});
