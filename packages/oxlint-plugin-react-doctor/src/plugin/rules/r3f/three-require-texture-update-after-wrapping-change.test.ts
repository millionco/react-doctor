import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireTextureUpdateAfterWrappingChange } from "./three-require-texture-update-after-wrapping-change.js";

describe("three-require-texture-update-after-wrapping-change", () => {
  it("reports post-render wrapping changes without uploads on every path", () => {
    const code = `
      import { RepeatWrapping, Texture, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const texture = new Texture();
      renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
        texture.wrapS = RepeatWrapping;
        if (changed) texture.needsUpdate = true;
      });
    `;
    expect(runRule(threeRequireTextureUpdateAfterWrappingChange, code).diagnostics).toHaveLength(1);
  });

  it("allows initial configuration, covered uploads, unrelated values, and unknown renderers", () => {
    const code = `
      import { RepeatWrapping, Texture, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const initial = new Texture();
      initial.wrapS = RepeatWrapping;
      const texture = new Texture();
      renderer.setAnimationLoop(() => {
        renderer.render(scene, camera);
        if (changed) {
          texture.wrapT = RepeatWrapping;
          texture.needsUpdate = true;
        }
      });
      const unknown = createTexture();
      unknown.wrapS = RepeatWrapping;
      customRenderer.render(scene, camera);
      texture.wrapS = RepeatWrapping;
    `;
    expect(runRule(threeRequireTextureUpdateAfterWrappingChange, code).diagnostics).toHaveLength(0);
  });
});
