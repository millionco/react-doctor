import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threePreferSetAnimationLoop } from "./three-prefer-set-animation-loop.js";

describe("three-prefer-set-animation-loop", () => {
  it("reports recursive animation frames that render with Three.js", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      function frame() { renderer.render(scene, camera); requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it("allows renderer-managed, unrelated, shadowed, and nonrendering animation frames", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
      requestAnimationFrame(() => updateDom());
      const run = (requestAnimationFrame) => requestAnimationFrame(() => renderer.render(scene, camera));
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(0);
  });
});
