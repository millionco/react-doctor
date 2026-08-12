import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threePreferGpuInstancedAnimation } from "./three-prefer-gpu-instanced-animation.js";

describe("three-prefer-gpu-instanced-animation", () => {
  it("reports repeated matrix updates in a Three.js animation loop", () => {
    const code = `
      import { InstancedMesh, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const instances = new InstancedMesh(geometry, material, count);
      renderer.setAnimationLoop(() => {
        for (let index = 0; index < count; index += 1) {
          instances.setMatrixAt(index, matrix);
        }
        renderer.render(scene, camera);
      });
    `;
    expect(runRule(threePreferGpuInstancedAnimation, code).diagnostics).toHaveLength(1);
  });

  it("allows one-off updates, non-rendering loops, and unrelated objects", () => {
    const code = `
      import { InstancedMesh, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const instances = new InstancedMesh(geometry, material, count);
      renderer.setAnimationLoop(() => {
        instances.setMatrixAt(0, matrix);
      });
      for (const index of indices) instances.setMatrixAt(index, matrix);
      customRenderer.setAnimationLoop(() => {
        for (const index of indices) object.setMatrixAt(index, matrix);
      });
    `;
    expect(runRule(threePreferGpuInstancedAnimation, code).diagnostics).toHaveLength(0);
  });

  it("allows a dirty-gated batch that does not animate every frame", () => {
    const code = `
      import { InstancedMesh, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const instances = new InstancedMesh(geometry, material, count);
      const updateInstances = () => {
        for (let index = 0; index < count; index += 1) {
          instances.setMatrixAt(index, matrix);
        }
      };
      renderer.setAnimationLoop(() => {
        if (isDirty) updateInstances();
        renderer.render(scene, camera);
      });
    `;
    expect(runRule(threePreferGpuInstancedAnimation, code).diagnostics).toHaveLength(0);
  });
});
