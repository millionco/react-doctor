import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidOrthographicCamera } from "./three-valid-orthographic-camera.js";

describe("three-valid-orthographic-camera", () => {
  it("reports degenerate frusta and reversed clipping planes", () => {
    const code = `
      import { OrthographicCamera as Camera } from "three";
      import * as THREE from "three";
      new Camera(1, 1, 1, -1, 0, 10);
      new Camera(-1, 1, 2, 2, 0, 10);
      new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 10);
      new Camera(-1, 1, 1, -1, 5, 5);
      const camera = new Camera();
      camera.near = -0.1;
    `;
    expect(runRule(threeValidOrthographicCamera, code).diagnostics).toHaveLength(3);
  });

  it("allows valid, dynamic, and unrelated cameras", () => {
    const code = `
      import { OrthographicCamera } from "three";
      import { OrthographicCamera as OtherCamera } from "camera-kit";
      new OrthographicCamera(-1, 1, 1, -1, 0, 100);
      new OrthographicCamera(-1, 1, 1, -1, -1, 1);
      new OrthographicCamera(left, right, top, bottom, near, far);
      new OtherCamera(1, 1, 1, 1, -1, -1);
    `;
    expect(runRule(threeValidOrthographicCamera, code).diagnostics).toHaveLength(0);
  });
});
