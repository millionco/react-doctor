import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeCapDevicePixelRatio } from "./three-cap-device-pixel-ratio.js";

describe("three-cap-device-pixel-ratio", () => {
  it.each([
    `import { WebGLRenderer } from "three";
     const renderer = new WebGLRenderer();
     renderer.setPixelRatio(window.devicePixelRatio);`,
    `import * as THREE from "three";
     const renderer = new THREE.WebGLRenderer();
     const ratio = globalThis.devicePixelRatio;
     renderer["setPixelRatio"](ratio);`,
    `import { WebGPURenderer as Renderer } from "three/webgpu";
     const renderer = new Renderer();
     const { devicePixelRatio } = window;
     renderer.setPixelRatio(devicePixelRatio * 1);`,
  ])("flags raw device pixel ratio passed to a Three.js renderer", (code) => {
    expect(runRule(threeCapDevicePixelRatio, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { WebGLRenderer } from "three";
     const renderer = new WebGLRenderer();
     renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));`,
    `import { WebGLRenderer } from "three";
     const renderer = new WebGLRenderer();
     renderer.setPixelRatio(2);`,
    `const renderer = createRenderer(); renderer.setPixelRatio(window.devicePixelRatio);`,
    `import { WebGLRenderer } from "other";
     const renderer = new WebGLRenderer();
     renderer.setPixelRatio(window.devicePixelRatio);`,
  ])("allows bounded or unproven renderer pixel ratios", (code) => {
    expect(runRule(threeCapDevicePixelRatio, code).diagnostics).toHaveLength(0);
  });
});
