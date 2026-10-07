import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoSyncReadbackInAnimationLoop } from "./three-no-sync-readback-in-animation-loop.js";

describe("three-no-sync-readback-in-animation-loop", () => {
  it("reports synchronous renderer readback inside a proven loop", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setAnimationLoop(() => {
        renderer.readRenderTargetPixels(target, 0, 0, 1, 1, buffer);
        renderer.render(scene, camera);
      });
    `;
    expect(runRule(threeNoSyncReadbackInAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it("allows async, event-driven, and unrelated readback", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, buffer);
      renderer.setAnimationLoop(() => {
        renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1, buffer);
        renderer.render(scene, camera);
      });
    `;
    expect(runRule(threeNoSyncReadbackInAnimationLoop, code).diagnostics).toHaveLength(0);
  });
});
