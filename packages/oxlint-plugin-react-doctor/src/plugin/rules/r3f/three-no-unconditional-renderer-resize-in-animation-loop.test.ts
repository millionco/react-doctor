import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoUnconditionalRendererResizeInAnimationLoop } from "./three-no-unconditional-renderer-resize-in-animation-loop.js";

describe("three-no-unconditional-renderer-resize-in-animation-loop", () => {
  it("reports renderer resizing directly on every frame", () => {
    const code = `
      import * as THREE from "three";
      const renderer = new THREE.WebGLRenderer();
      renderer.setAnimationLoop(() => {
        renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        renderer.render(scene, camera);
      });
    `;
    expect(
      runRule(threeNoUnconditionalRendererResizeInAnimationLoop, code).diagnostics,
    ).toHaveLength(1);
  });

  it("allows guarded resizing and resize handlers", () => {
    const code = `
      import * as THREE from "three";
      const renderer = new THREE.WebGLRenderer();
      renderer.setAnimationLoop(() => {
        if (canvas.width !== canvas.clientWidth) renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
        renderer.render(scene, camera);
      });
      window.addEventListener("resize", () => renderer.setSize(innerWidth, innerHeight));
    `;
    expect(
      runRule(threeNoUnconditionalRendererResizeInAnimationLoop, code).diagnostics,
    ).toHaveLength(0);
  });

  it("allows early-return guards and unrelated setSize methods", () => {
    const code = `
      import * as THREE from "three";
      const renderer = new THREE.WebGLRenderer();
      renderer.setAnimationLoop(() => {
        if (!didSizeChange) return;
        renderer.setSize(width, height);
        renderer.render(scene, camera);
      });
      object.setSize(width, height);
    `;
    expect(
      runRule(threeNoUnconditionalRendererResizeInAnimationLoop, code).diagnostics,
    ).toHaveLength(0);
  });

  it("preserves diagnostics through transparent receiver wrappers", () => {
    const code = `
      import * as THREE from "three";
      const renderer = new THREE.WebGLRenderer();
      const frame = () => {
        ;(renderer as any).setSize(width, height);
        ;(renderer as any).render(scene, camera);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    `;
    expect(
      runRule(threeNoUnconditionalRendererResizeInAnimationLoop, code).diagnostics,
    ).toHaveLength(1);
  });
});
