import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidPbrMaterialProperties } from "./three-valid-pbr-material-properties.js";

describe("three-valid-pbr-material-properties", () => {
  it("reports invalid factors assigned after construction", () => {
    const code = `
      import { MeshStandardMaterial } from "three";
      const material = new MeshStandardMaterial();
      material.roughness = 2;
      material.metalness = -1;
    `;
    expect(runRule(threeValidPbrMaterialProperties, code).diagnostics).toHaveLength(2);
  });

  it("reports static PBR factors outside zero and one", () => {
    const code = `
      import * as THREE from "three";
      const TOO_ROUGH = 2 / 1;
      new THREE.MeshStandardMaterial({ roughness: TOO_ROUGH });
      new THREE.MeshPhysicalMaterial({ metalness: -0.25 });
    `;
    expect(runRule(threeValidPbrMaterialProperties, code).diagnostics).toHaveLength(2);
  });

  it("allows normalized, dynamic, spread, and basic material values", () => {
    const code = `
      import { MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
      new MeshStandardMaterial({ roughness: 0, metalness: 1 });
      new MeshPhysicalMaterial({ roughness: getRoughness() });
      new MeshStandardMaterial({ roughness: 2, ...parameters });
      new MeshBasicMaterial({ roughness: 2 });
    `;
    expect(runRule(threeValidPbrMaterialProperties, code).diagnostics).toHaveLength(0);
  });

  it("ignores lookalike constructors", () => {
    expect(
      runRule(
        threeValidPbrMaterialProperties,
        `class MeshStandardMaterial {} new MeshStandardMaterial({ roughness: 2 });`,
      ).diagnostics,
    ).toHaveLength(0);
  });
});
