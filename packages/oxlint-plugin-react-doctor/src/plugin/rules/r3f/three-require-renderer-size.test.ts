import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireRendererSize } from "./three-require-renderer-size.js";

describe("three-require-renderer-size", () => {
  it("reports a generated renderer canvas rendered at its default size", () => {
    const code = `
      import * as THREE from "three";
      const renderer = new THREE.WebGLRenderer();
      renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    `;
    expect(runRule(threeRequireRendererSize, code).diagnostics).toHaveLength(1);
  });

  it("allows setSize, drawing-buffer sizing, and explicit canvas dimensions", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const first = new WebGLRenderer();
      first.setSize(width, height);
      first.render(scene, camera);
      const second = new WebGLRenderer();
      second.setDrawingBufferSize(width, height, pixelRatio);
      second.render(scene, camera);
      const third = new WebGLRenderer();
      third.domElement.width = width;
      third.render(scene, camera);
    `;
    expect(runRule(threeRequireRendererSize, code).diagnostics).toHaveLength(0);
  });

  it("allows supplied canvases and external renderer configuration", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const supplied = new WebGLRenderer({ canvas });
      supplied.render(scene, camera);
      const external = new WebGLRenderer();
      configureRenderer(external);
      external.render(scene, camera);
    `;
    expect(runRule(threeRequireRendererSize, code).diagnostics).toHaveLength(0);
  });

  it("treats TypeScript wrappers around renderer receivers as transparent", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const unsized = new WebGLRenderer();
      (unsized as any).render(scene, camera);
      const sized = new WebGLRenderer();
      sized!.setSize(width, height);
      sized!.render(scene, camera);
    `;
    expect(runRule(threeRequireRendererSize, code).diagnostics).toHaveLength(1);
  });
});
