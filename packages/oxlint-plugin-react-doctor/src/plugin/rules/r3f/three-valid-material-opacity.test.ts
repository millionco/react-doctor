import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidMaterialOpacity } from "./three-valid-material-opacity.js";

describe("three-valid-material-opacity", () => {
  it("reports static Three.js material opacity outside zero and one", () => {
    const code = `
      import { MeshBasicMaterial, MeshStandardMaterial as Standard } from "three";
      new MeshBasicMaterial({ opacity: -0.1 });
      new Standard({ opacity: 1.2 });
    `;
    expect(runRule(threeValidMaterialOpacity, code).diagnostics).toHaveLength(2);
  });

  it("reports invalid opacity assigned after construction", () => {
    const code = `
      import { MeshBasicMaterial } from "three";
      const material = new MeshBasicMaterial();
      material.opacity = -1;
    `;
    expect(runRule(threeValidMaterialOpacity, code).diagnostics).toHaveLength(1);
  });

  it("allows normalized, dynamic, spread, and non-Three.js values", () => {
    const code = `
      import * as THREE from "three";
      new THREE.MeshBasicMaterial({ opacity: 0 });
      new THREE.MeshStandardMaterial({ opacity: 1 });
      new THREE.MeshPhysicalMaterial({ opacity });
      new THREE.MeshBasicMaterial({ ...props, opacity: 2 });
      new Material({ opacity: 2 });
    `;
    expect(runRule(threeValidMaterialOpacity, code).diagnostics).toHaveLength(0);
  });
});
