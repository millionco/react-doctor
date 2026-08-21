import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoIgnoredBasicMaterialProperties } from "./three-no-ignored-basic-material-properties.js";

describe("three-no-ignored-basic-material-properties", () => {
  it("reports ignored properties assigned after construction", () => {
    const code = `
      import { MeshBasicMaterial } from "three";
      const material = new MeshBasicMaterial();
      material.roughness = 0.5;
      material.metalness = 1;
    `;
    expect(runRule(threeNoIgnoredBasicMaterialProperties, code).diagnostics).toHaveLength(2);
  });

  it("reports PBR-only properties passed to MeshBasicMaterial", () => {
    const code = `
      import { MeshBasicMaterial as BasicMaterial } from "three";
      import * as THREE from "three";
      const roughness = 0.4;
      new BasicMaterial({ color: "red", roughness });
      new THREE.MeshBasicMaterial({ metalness: 0.8 });
    `;
    expect(runRule(threeNoIgnoredBasicMaterialProperties, code).diagnostics).toHaveLength(2);
  });

  it("allows supported basic properties and PBR material properties", () => {
    const code = `
      import { MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
      new MeshBasicMaterial({ color: "red", map: texture, wireframe: true });
      new MeshStandardMaterial({ roughness: 0.4, metalness: 0.8 });
      new MeshPhysicalMaterial({ roughness: 0.2, metalness: 1 });
    `;
    expect(runRule(threeNoIgnoredBasicMaterialProperties, code).diagnostics).toHaveLength(0);
  });

  it("ignores dynamic, custom, and shadowed material constructors", () => {
    const code = `
      import { MeshBasicMaterial as CustomMaterial } from "material-kit";
      import { MeshBasicMaterial } from "three";
      new MeshBasicMaterial(options);
      new CustomMaterial({ roughness: 0.4 });
      const createMaterial = (MeshBasicMaterial) => new MeshBasicMaterial({ metalness: 1 });
    `;
    expect(runRule(threeNoIgnoredBasicMaterialProperties, code).diagnostics).toHaveLength(0);
  });
});
