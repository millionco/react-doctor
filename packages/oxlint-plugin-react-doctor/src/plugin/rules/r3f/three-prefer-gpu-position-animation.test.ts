import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threePreferGpuPositionAnimation } from "./three-prefer-gpu-position-animation.js";

describe("three-prefer-gpu-position-animation", () => {
  it("reports repeated position-buffer writes in Three.js animation loops", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const positions = particles.geometry.attributes.position;
      renderer.setAnimationLoop(() => {
        for (let index = 0; index < positions.count; index += 1) {
          positions.setXYZ(index, index, performance.now(), 0);
        }
        positions.needsUpdate = true;
      });
    `;
    expect(runRule(threePreferGpuPositionAnimation, code).diagnostics).toHaveLength(1);
  });

  it("reports repeated writes in recursive rendering animation frames", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const render = () => {
        for (const index of indices) {
          particles.geometry.getAttribute("position").setZ(index, index);
        }
        renderer.render(scene, camera);
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    `;
    expect(runRule(threePreferGpuPositionAnimation, code).diagnostics).toHaveLength(1);
  });

  it("reports direct typed-array rewrites and bulk fills", () => {
    const directWrite = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const positionArray = particles.geometry.getAttribute("position").array;
      renderer.setAnimationLoop(() => {
        for (let index = 0; index < positionArray.length; index += 1) {
          positionArray[index] = index;
        }
      });
    `;
    const bulkFill = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setAnimationLoop(() => {
        particles.geometry.attributes.position.array.fill(0);
      });
    `;
    expect(runRule(threePreferGpuPositionAnimation, directWrite).diagnostics).toHaveLength(1);
    expect(runRule(threePreferGpuPositionAnimation, bulkFill).diagnostics).toHaveLength(1);
  });

  it("reports an animation callback once when it rewrites several position components", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const positions = particles.geometry.attributes.position.array;
      renderer.setAnimationLoop(() => {
        for (let index = 0; index < positions.length; index += 3) {
          positions[index] += 1;
          positions[index + 1] += 1;
          positions[index + 2] += 1;
        }
      });
    `;
    expect(runRule(threePreferGpuPositionAnimation, code).diagnostics).toHaveLength(1);
  });

  it("allows shader animation, one-off writes, and non-position buffers", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      renderer.setAnimationLoop(() => {
        particles.geometry.attributes.position.setX(0, performance.now());
        particles.geometry.attributes.position.array[0] = 1;
        for (const index of indices) colors.setXYZ(index, 1, 0, 0);
        material.uniforms.time.value = performance.now();
      });
    `;
    expect(runRule(threePreferGpuPositionAnimation, code).diagnostics).toHaveLength(0);
  });

  it("allows conditionally streamed position data that is not continuous animation", () => {
    const code = `
      import { WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const positions = particles.geometry.attributes.position;
      renderer.setAnimationLoop(() => {
        if (hasNewTrace) {
          for (let index = 0; index < positions.count; index += 1) {
            positions.setXYZ(index, trace[index].x, trace[index].y, trace[index].z);
          }
          positions.needsUpdate = true;
        }
      });
    `;
    expect(runRule(threePreferGpuPositionAnimation, code).diagnostics).toHaveLength(0);
  });

  it("ignores non-rendering loops and unrelated renderers", () => {
    const code = `
      const update = () => {
        for (const index of indices) geometry.attributes.position.setX(index, index);
      };
      customRenderer.setAnimationLoop(() => {
        for (const index of indices) geometry.attributes.position.setX(index, index);
      });
    `;
    expect(runRule(threePreferGpuPositionAnimation, code).diagnostics).toHaveLength(0);
  });
});
