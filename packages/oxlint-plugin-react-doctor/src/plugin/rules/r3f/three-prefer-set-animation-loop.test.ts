import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threePreferSetAnimationLoop } from "./three-prefer-set-animation-loop.js";

describe("three-prefer-set-animation-loop", () => {
  it("reports recursive animation frames in a WebXR renderer", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.xr.enabled = true;
      function frame() { renderer.render(scene, camera); requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it("allows non-XR manual frames, renderer-managed frames, and unrelated callbacks", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      function frame() { renderer.render(scene, camera); requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
      requestAnimationFrame(() => updateDom());
      const run = (requestAnimationFrame) => requestAnimationFrame(() => renderer.render(scene, camera));
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(0);
  });

  it("recognizes an imported WebXR session button without trusting unrelated xr properties", () => {
    const webXr = `
      import { WebGLRenderer } from "three";
      import { VRButton } from "three/addons/webxr/VRButton.js";
      const renderer = new WebGLRenderer();
      function frame() { renderer.render(scene, camera); requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
      document.body.append(VRButton.createButton(renderer));
    `;
    const unrelated = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      state.xr.enabled = true;
      function frame() { renderer.render(scene, camera); requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
    `;
    expect(runRule(threePreferSetAnimationLoop, webXr).diagnostics).toHaveLength(1);
    expect(runRule(threePreferSetAnimationLoop, unrelated).diagnostics).toHaveLength(0);
  });
});
