import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoCompileInAnimationLoop } from "./three-no-compile-in-animation-loop.js";

describe("three-no-compile-in-animation-loop", () => {
  it("reports compile and compileAsync in proven loops", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setAnimationLoop(() => {
        renderer.compile(scene, camera);
        renderer.compileAsync(scene, camera);
        renderer.render(scene, camera);
      });
    `;
    expect(runRule(threeNoCompileInAnimationLoop, code).diagnostics).toHaveLength(2);
  });

  it("allows precompilation outside loops and unrelated compilers", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.compile(scene, camera);
      renderer.setAnimationLoop(() => {
        compiler.compile(scene);
        renderer.render(scene, camera);
      });
    `;
    expect(runRule(threeNoCompileInAnimationLoop, code).diagnostics).toHaveLength(0);
  });

  it("allows a one-shot compile stage that advances after its switch", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      let loadingStage = 0;
      const buildNextStage = () => {
        switch (loadingStage) {
          case 4:
            renderer.compileAsync(scene, camera);
            break;
        }
        loadingStage += 1;
      };
      renderer.setAnimationLoop(() => buildNextStage());
    `;
    expect(runRule(threeNoCompileInAnimationLoop, code).diagnostics).toHaveLength(0);
  });

  it("reports a compile in a switch that does not advance its stage", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      let loadingStage = 0;
      renderer.setAnimationLoop(() => {
        switch (loadingStage) {
          case 0:
            renderer.compile(scene, camera);
            break;
        }
      });
    `;
    expect(runRule(threeNoCompileInAnimationLoop, code).diagnostics).toHaveLength(1);
  });
});
