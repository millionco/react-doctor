import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoAsyncAnimationLoop } from "./three-no-async-animation-loop.js";

describe("three-no-async-animation-loop", () => {
  it("flags an async setAnimationLoop callback", () => {
    const result = runRule(
      threeNoAsyncAnimationLoop,
      `import * as THREE from "three";
       const renderer = new THREE.WebGLRenderer();
       renderer.setAnimationLoop(async () => { await update(); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an async callback wrapped by React useCallback", () => {
    const result = runRule(
      threeNoAsyncAnimationLoop,
      `import { useCallback } from "react";
       import { WebGLRenderer } from "three";
       const renderer = new WebGLRenderer();
       const frame = useCallback(async () => update(), []);
       renderer.setAnimationLoop(frame);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an async recursive RAF loop that renders with Three.js once", () => {
    const result = runRule(
      threeNoAsyncAnimationLoop,
      `import { WebGLRenderer } from "three";
       const renderer = new WebGLRenderer();
       async function frame() {
         await update();
         renderer.render(scene, camera);
         requestAnimationFrame(frame);
       }
       requestAnimationFrame(frame);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows synchronous callbacks and unrelated renderers", () => {
    const result = runRule(
      threeNoAsyncAnimationLoop,
      `import { WebGLRenderer } from "three";
       const renderer = new WebGLRenderer();
       renderer.setAnimationLoop(() => update());
       localRenderer.setAnimationLoop(async () => update());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
