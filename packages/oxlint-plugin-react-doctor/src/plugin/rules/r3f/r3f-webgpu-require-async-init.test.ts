import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuRequireAsyncInit } from "./r3f-webgpu-require-async-init.js";

describe("r3f-webgpu-require-async-init", () => {
  it.each([
    `import { Canvas } from "@react-three/fiber"; import { WebGPURenderer } from "three/webgpu"; const scene = <Canvas gl={() => new WebGPURenderer()} />;`,
    `import { Canvas } from "@react-three/fiber"; import * as THREE from "three/webgpu"; const scene = <Canvas gl={async (props) => new THREE.WebGPURenderer(props)} />;`,
    `import { Canvas } from "@react-three/fiber"; import { WebGPURenderer } from "three/webgpu"; const createRenderer = async () => { const renderer = new WebGPURenderer(); if (supported) await renderer.init(); return renderer; }; const scene = <Canvas gl={createRenderer} />;`,
    `import { Canvas } from "@react-three/fiber"; import { WebGPURenderer } from "three/webgpu"; const createRenderer = async () => { const renderer = new WebGPURenderer(); return renderer; await renderer.init(); }; const scene = <Canvas gl={createRenderer} />;`,
  ])("reports WebGPU factories without dominating awaited initialization", (code) => {
    expect(runRule(r3fWebgpuRequireAsyncInit, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Canvas } from "@react-three/fiber"; import { WebGPURenderer } from "three/webgpu"; const scene = <Canvas gl={async (props) => { const renderer = new WebGPURenderer(props); await renderer.init(); return renderer; }} />;`,
    `import { Canvas } from "@react-three/fiber"; import { WebGLRenderer } from "three"; const scene = <Canvas gl={(props) => new WebGLRenderer(props)} />;`,
    `import { Canvas } from "@react-three/fiber"; const scene = <Canvas gl={createRenderer} />;`,
    `import { Canvas } from "other"; import { WebGPURenderer } from "three/webgpu"; const scene = <Canvas gl={() => new WebGPURenderer()} />;`,
  ])("keeps initialized, WebGL, unresolved, and unrelated factories quiet", (code) => {
    expect(runRule(r3fWebgpuRequireAsyncInit, code).diagnostics).toHaveLength(0);
  });
});
