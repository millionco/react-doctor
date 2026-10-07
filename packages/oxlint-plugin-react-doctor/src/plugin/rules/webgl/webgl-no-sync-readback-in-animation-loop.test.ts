import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { webglNoSyncReadbackInAnimationLoop } from "./webgl-no-sync-readback-in-animation-loop.js";

describe("webgl-no-sync-readback-in-animation-loop", () => {
  it.each([
    `const gl = canvas.getContext("webgl");
     const pixels = new Uint8Array(4);
     const frame = () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels); requestAnimationFrame(frame); };
     requestAnimationFrame(frame);`,
    `const gl = canvas.getContext("webgl2");
     const data = new Float32Array(4);
     function frame() { gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data); window.requestAnimationFrame(frame); }
     window.requestAnimationFrame(frame);`,
    `const gl = canvas.getContext("webgl2");
     const frame = () => { gl.finish(); requestAnimationFrame(frame); };
     requestAnimationFrame(frame);`,
  ])("flags blocking raw WebGL work in recursive RAF loops", (code) => {
    expect(runRule(webglNoSyncReadbackInAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it("flags synchronous Three.js render-target readback in setAnimationLoop", () => {
    const result = runRule(
      webglNoSyncReadbackInAnimationLoop,
      `import { WebGLRenderer } from "three";
       const renderer = new WebGLRenderer();
       renderer.setAnimationLoop(() => renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixels));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `const gl = canvas.getContext("webgl"); const pixels = new Uint8Array(4); requestAnimationFrame(() => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels));`,
    `const gl = canvas.getContext("webgl2"); const frame = () => { if (capture) gl.finish(); requestAnimationFrame(frame); }; requestAnimationFrame(frame);`,
    `const gl = canvas.getContext("webgl2"); const frame = () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0); requestAnimationFrame(frame); }; requestAnimationFrame(frame);`,
    `const gl = canvas.getContext("2d"); const frame = () => { gl.finish(); requestAnimationFrame(frame); }; requestAnimationFrame(frame);`,
  ])("ignores non-repeating, conditional, asynchronous, or non-WebGL work", (code) => {
    expect(runRule(webglNoSyncReadbackInAnimationLoop, code).diagnostics).toHaveLength(0);
  });
});
