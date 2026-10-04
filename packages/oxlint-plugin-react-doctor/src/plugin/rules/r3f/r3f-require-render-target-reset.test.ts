import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireRenderTargetReset } from "./r3f-require-render-target-reset.js";

describe("r3f-require-render-target-reset", () => {
  it.each([
    `import { useFrame } from "@react-three/fiber";
     import { WebGLRenderTarget } from "three";
     const target = new WebGLRenderTarget(256, 256);
     const Scene = () => { useFrame((state) => { state.gl.setRenderTarget(target); state.gl.render(scene, camera); }); return null; };`,
    `import { useFrame } from "@react-three/fiber";
     import { WebGLRenderTarget } from "three";
     const target = new WebGLRenderTarget(256, 256);
     const Scene = () => { useFrame(({ gl }) => { gl.setRenderTarget(target); if (restore) gl.setRenderTarget(null); }); return null; };`,
  ])("reports missing target resets", (code) => {
    expect(runRule(r3fRequireRenderTargetReset, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { useFrame } from "@react-three/fiber";
     import { WebGLRenderTarget } from "three";
     const target = new WebGLRenderTarget(256, 256);
     const Scene = () => { useFrame(({ gl }) => { gl.setRenderTarget(target); gl.render(scene, camera); gl.setRenderTarget(null); }); return null; };`,
    `import { useFrame } from "@react-three/fiber";
     import { restoreRenderer } from "./renderer";
     import { WebGLRenderTarget } from "three";
     const target = new WebGLRenderTarget(256, 256);
     const Scene = () => { useFrame(({ renderer }) => { renderer.setRenderTarget(target); restoreRenderer(renderer); }); return null; };`,
    `import { useFrame } from "@react-three/fiber";
     const Scene = () => { useFrame(({ gl }) => gl.setRenderTarget(dynamicTarget)); return null; };`,
    `const useFrame = (callback) => callback({ gl: customRenderer }); useFrame(({ gl }) => gl.setRenderTarget(target));`,
  ])("allows covered, delegated, dynamic, and shadowed cases", (code) => {
    expect(runRule(r3fRequireRenderTargetReset, code).diagnostics).toHaveLength(0);
  });
});
