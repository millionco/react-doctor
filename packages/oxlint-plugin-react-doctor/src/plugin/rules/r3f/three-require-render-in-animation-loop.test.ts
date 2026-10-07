import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireRenderInAnimationLoop } from "./three-require-render-in-animation-loop.js";

describe("three-require-render-in-animation-loop", () => {
  it("reports a Three.js animation loop with no reachable render", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setAnimationLoop(() => {
        mesh.rotation.x += 0.01;
      });
    `;
    expect(runRule(threeRequireRenderInAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it("allows direct, local, composer, and opaque render paths", () => {
    const code = `
      import { WebGLRenderer } from "three";
      import { renderFrame } from "./render-frame";
      const first = new WebGLRenderer();
      first.setAnimationLoop(() => first.render(scene, camera));
      const second = new WebGLRenderer();
      const draw = () => composer.render();
      second.setAnimationLoop(() => draw());
      const third = new WebGLRenderer();
      third.setAnimationLoop(() => renderFrame());
    `;
    expect(runRule(threeRequireRenderInAnimationLoop, code).diagnostics).toHaveLength(0);
  });

  it("ignores null callbacks, unresolved callbacks, and unrelated renderers", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setAnimationLoop(null);
      renderer.setAnimationLoop(importedCallback);
      renderer.setAnimationLoop(() => globalRenderFrame());
      customRenderer.setAnimationLoop(() => update());
    `;
    expect(runRule(threeRequireRenderInAnimationLoop, code).diagnostics).toHaveLength(0);
  });
});
