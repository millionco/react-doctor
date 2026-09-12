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

  it("allows an imported viewer whose renderer cannot be resolved", () => {
    const code = `
      import { Viewer } from "./scene/viewer";
      const viewer = new Viewer(canvas);
      function frame() {
        viewer.frame();
        app.tick();
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

describe("three-prefer-set-animation-loop renderer provenance", () => {
  it.each([
    "",
    'import { Vector3 } from "three";',
    'import { Canvas } from "@react-three/fiber";',
    'import { WebGLRenderer } from "three"; const renderer = new WebGLRenderer();',
  ])("allows a 2D canvas loop with unrelated imports: %s", (declaration) => {
    expect(
      runRule(
        threePreferSetAnimationLoop,
        `
      ${declaration}
      const context = canvas.getContext("2d");
      const frame = () => { context.fillRect(0, 0, 1, 1); requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    `,
      ).diagnostics,
    ).toHaveLength(0);
  });

  it.each([
    'import { WebGLRenderer as Renderer } from "three";',
    'import { WebGPURenderer as Renderer } from "three/webgpu";',
    'const { WebGLRenderer: Renderer } = require("three");',
  ])("reports a loop that calls a local rendering helper: %s", (declaration) => {
    expect(
      runRule(
        threePreferSetAnimationLoop,
        `
      ${declaration}
      const renderer = new Renderer();
      const draw = () => renderer.render(scene, camera);
      const frame = () => { draw(); window.requestAnimationFrame(frame); };
      window.requestAnimationFrame(frame);
    `,
      ).diagnostics,
    ).toHaveLength(1);
  });

  it("does not use an uncalled nested function as renderer evidence", () => {
    expect(
      runRule(
        threePreferSetAnimationLoop,
        `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const frame = () => {
        const draw = () => renderer.render(scene, camera);
        updateDom();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    `,
      ).diagnostics,
    ).toHaveLength(0);
  });

  it("does not treat a local render method as a Three.js renderer", () => {
    expect(
      runRule(
        threePreferSetAnimationLoop,
        `
      import { Vector3 } from "three";
      const renderer = { render: () => updateDom() };
      const frame = () => { renderer.render(); requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    `,
      ).diagnostics,
    ).toHaveLength(0);
  });

  it("reports only the Three.js loop when a file also animates a 2D canvas", () => {
    const diagnostics = runRule(
      threePreferSetAnimationLoop,
      `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const context = canvas.getContext("2d");
      const draw2d = () => { context.fillRect(0, 0, 1, 1); requestAnimationFrame(draw2d); };
      const draw3d = () => { renderer.render(scene, camera); requestAnimationFrame(draw3d); };
      requestAnimationFrame(draw2d);
      requestAnimationFrame(draw3d);
    `,
    ).diagnostics;
    expect(diagnostics).toHaveLength(1);
  });

  it("allows conditional scheduling even when the callback renders with Three.js", () => {
    expect(
      runRule(
        threePreferSetAnimationLoop,
        `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const frame = () => {
        renderer.render(scene, camera);
        if (needsUpdate) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    `,
      ).diagnostics,
    ).toHaveLength(0);
  });
});
