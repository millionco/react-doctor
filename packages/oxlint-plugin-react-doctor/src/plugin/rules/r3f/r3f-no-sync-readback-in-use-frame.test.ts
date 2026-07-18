import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoSyncReadbackInUseFrame } from "./r3f-no-sync-readback-in-use-frame.js";

describe("r3f-no-sync-readback-in-use-frame", () => {
  it("reports synchronous reads from the R3F root renderer", () => {
    const result = runRule(
      r3fNoSyncReadbackInUseFrame,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ gl }) => gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels));
       useFrame((state) => state.renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixels));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports Canvas 2D and typed-array WebGL readback", () => {
    const result = runRule(
      r3fNoSyncReadbackInUseFrame,
      `import { useFrame } from "@react-three/fiber";
       useFrame(() => {
         const context = canvas.getContext("2d");
         context.getImageData(0, 0, canvas.width, canvas.height);
         const webgl = canvas.getContext("webgl2");
         const pixels = new Uint8Array(4);
         webgl.readPixels(0, 0, 1, 1, RGBA, UNSIGNED_BYTE, pixels);
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows async, one-shot, PBO, and setup-only reads", () => {
    const result = runRule(
      r3fNoSyncReadbackInUseFrame,
      `import { useFrame } from "@react-three/fiber";
       const context = canvas.getContext("2d");
       context.getImageData(0, 0, 1, 1);
       useFrame(({ gl }) => {
         gl.readRenderTargetPixelsAsync(target, 0, 0, 1, 1, pixels);
         if (captureRequested.current) gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels);
         if (captureRequested.current) [target].forEach((currentTarget) => gl.readRenderTargetPixels(currentTarget, 0, 0, 1, 1, pixels));
         const webgl = canvas.getContext("webgl2");
         webgl.readPixels(0, 0, 1, 1, RGBA, UNSIGNED_BYTE, 0);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows readback in a conditionally called local helper", () => {
    const result = runRule(
      r3fNoSyncReadbackInUseFrame,
      `import { useFrame } from "@react-three/fiber";
       useFrame(({ gl }) => {
         const capture = () => gl.readRenderTargetPixels(target, 0, 0, 1, 1, pixels);
         if (captureRequested.current) capture();
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores same-named methods without receiver provenance", () => {
    const result = runRule(
      r3fNoSyncReadbackInUseFrame,
      `import { useFrame } from "@react-three/fiber";
       useFrame(() => analytics.readRenderTargetPixels());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
