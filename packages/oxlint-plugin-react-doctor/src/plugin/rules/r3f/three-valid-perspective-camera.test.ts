import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidPerspectiveCamera } from "./three-valid-perspective-camera.js";

describe("three-valid-perspective-camera", () => {
  it("reports invalid clipping values assigned after construction", () => {
    const code = `
      import { PerspectiveCamera } from "three";
      const camera = new PerspectiveCamera();
      camera.aspect = 0;
      camera.near = -1;
      camera.far = 0;
    `;
    expect(runRule(threeValidPerspectiveCamera, code).diagnostics).toHaveLength(3);
  });

  it("reports invalid static aspect and clipping planes", () => {
    const code = `
      import { PerspectiveCamera as Camera } from "three";
      import * as THREE from "three";
      const zero = 0;
      new Camera(75, zero, 0.1, 1000);
      new Camera(75, 1, 0, 1000);
      new THREE.PerspectiveCamera(75, 1, 100, 100);
      new THREE.PerspectiveCamera(75, 1, 100, 50);
      new THREE.PerspectiveCamera(75, 1, dynamicNear, 0);
    `;
    expect(runRule(threeValidPerspectiveCamera, code).diagnostics).toHaveLength(5);
  });

  it("allows defaults, valid values, and dynamic values", () => {
    const code = `
      import { PerspectiveCamera } from "three";
      new PerspectiveCamera();
      new PerspectiveCamera(75, 16 / 9, 0.1, 1000);
      new PerspectiveCamera(fieldOfView, aspect, near, far);
    `;
    expect(runRule(threeValidPerspectiveCamera, code).diagnostics).toHaveLength(0);
  });

  it("ignores unrelated, custom, and shadowed constructors", () => {
    const code = `
      import { PerspectiveCamera as CustomCamera } from "camera-kit";
      import { PerspectiveCamera } from "three";
      new CustomCamera(75, 0, 0, 0);
      const createCamera = (PerspectiveCamera) => new PerspectiveCamera(75, 0, 0, 0);
    `;
    expect(runRule(threeValidPerspectiveCamera, code).diagnostics).toHaveLength(0);
  });
});
