import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireCameraAspectOnResize } from "./three-require-camera-aspect-on-resize.js";

describe("three-require-camera-aspect-on-resize", () => {
  it("reports renderer resize handlers that leave a rendered camera aspect stale", () => {
    const code = `
      import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const camera = new PerspectiveCamera();
      window.addEventListener("resize", () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
      });
      renderer.render(new Scene(), camera);
    `;
    expect(runRule(threeRequireCameraAspectOnResize, code).diagnostics).toHaveLength(1);
  });

  it("allows direct and delegated camera aspect updates", () => {
    const code = `
      import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
      import { resizeCamera } from "./camera";
      const firstRenderer = new WebGLRenderer();
      const firstCamera = new PerspectiveCamera();
      window.onresize = () => {
        firstRenderer.setSize(window.innerWidth, window.innerHeight);
        firstCamera.aspect = window.innerWidth / window.innerHeight;
        firstCamera.updateProjectionMatrix();
      };
      firstRenderer.render(new Scene(), firstCamera);
      const secondRenderer = new WebGLRenderer();
      const secondCamera = new PerspectiveCamera();
      new ResizeObserver(() => {
        secondRenderer.setSize(width, height);
        resizeCamera(secondCamera);
      });
      secondRenderer.render(new Scene(), secondCamera);
    `;
    expect(runRule(threeRequireCameraAspectOnResize, code).diagnostics).toHaveLength(0);
  });

  it("ignores initial sizing, orthographic cameras, and unrelated renderers", () => {
    const code = `
      import { OrthographicCamera, Scene, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setSize(800, 600);
      window.addEventListener("resize", () => customRenderer.setSize(width, height));
      renderer.render(new Scene(), new OrthographicCamera());
    `;
    expect(runRule(threeRequireCameraAspectOnResize, code).diagnostics).toHaveLength(0);
  });
});
