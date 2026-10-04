import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequirePositionBufferUpdate } from "./three-require-position-buffer-update.js";

describe("three-require-position-buffer-update", () => {
  it("reports repeated position-buffer writes without an upload flag", () => {
    const code = `
      import * as THREE from "three";
      const renderer = new THREE.WebGLRenderer();
      const geometry = new THREE.BufferGeometry();
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      renderer.setAnimationLoop(() => {
        for (let index = 0; index < 100; index += 1) geometry.attributes.position.setXYZ(index, index, 0, 0);
        renderer.render(scene, camera);
      });
    `;
    expect(runRule(threeRequirePositionBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("allows a matching upload flag, helper-only loops, and non-position buffers", () => {
    const code = `
      import * as THREE from "three";
      const renderer = new THREE.WebGLRenderer();
      const geometry = new THREE.BufferGeometry();
      renderer.setAnimationLoop(() => {
        for (let index = 0; index < 100; index += 1) geometry.getAttribute("position").setX(index, index);
        geometry.getAttribute("position").needsUpdate = true;
        for (let index = 0; index < 100; index += 1) geometry.attributes.normal.setX(index, index);
        renderer.render(scene, camera);
      });
      requestAnimationFrame(externalFrame);
    `;
    expect(runRule(threeRequirePositionBufferUpdate, code).diagnostics).toHaveLength(0);
  });
});
