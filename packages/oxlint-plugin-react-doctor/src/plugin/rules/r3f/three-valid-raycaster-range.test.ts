import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidRaycasterRange } from "./three-valid-raycaster-range.js";

describe("three-valid-raycaster-range", () => {
  it("reports invalid constructor and assigned ranges", () => {
    const code = `
      import { Raycaster as Cast } from "three";
      import * as THREE from "three";
      new Cast(origin, direction, -1, 10);
      new THREE.Raycaster(origin, direction, 10, 5);
      const raycaster = new Cast();
      raycaster.near = -0.1;
    `;
    expect(runRule(threeValidRaycasterRange, code).diagnostics).toHaveLength(3);
  });

  it("allows valid, dynamic, and unrelated ranges", () => {
    const code = `
      import { Raycaster } from "three";
      import { Raycaster as Other } from "ray-kit";
      new Raycaster();
      new Raycaster(origin, direction, 0, Infinity);
      new Raycaster(origin, direction, near, far);
      new Other(origin, direction, -1, -2);
    `;
    expect(runRule(threeValidRaycasterRange, code).diagnostics).toHaveLength(0);
  });
});
