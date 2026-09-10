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

  it("reports the standalone Three.js scaffold animation loop", () => {
    const code = `
      import * as THREE from "three";
      const canvas = document.querySelector("#view");
      const renderer = new THREE.WebGLRenderer({ canvas });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      function frame() {
        renderer.render(scene, camera);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it("reports a recursive loop with @react-three/fiber import", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const viewer = setupViewer(canvas);
      function frame() {
        viewer.frame();
        app.tick();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it("allows a 2D canvas animation loop without Three.js imports", () => {
    const code = `
      const canvas = document.querySelector("canvas");
      const context = canvas.getContext("2d");
      function frame() {
        context.fillRect(0, 0, 1, 1);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(0);
  });

  it("allows renderer-managed frames and unrelated or shadowed callbacks", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
      requestAnimationFrame(() => updateDom());
      const run = (requestAnimationFrame) => requestAnimationFrame(() => renderer.render(scene, camera));
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(0);
  });

  it("allows finite animation-frame work that only reschedules conditionally", () => {
    const code = `
      function runBuildChunk() {
        while (stepIndex < steps.length && performance.now() < deadline) runStep();
        if (stepIndex < steps.length) {
          requestAnimationFrame(runBuildChunk);
          return;
        }
        finishBuild();
      }
      requestAnimationFrame(runBuildChunk);
    `;
    expect(runRule(threePreferSetAnimationLoop, code).diagnostics).toHaveLength(0);
  });
});
