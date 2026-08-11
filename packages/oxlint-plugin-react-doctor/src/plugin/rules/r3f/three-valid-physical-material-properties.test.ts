import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidPhysicalMaterialProperties } from "./three-valid-physical-material-properties.js";

describe("three-valid-physical-material-properties", () => {
  it("reports every statically invalid documented factor", () => {
    const code = `
      import { MeshPhysicalMaterial as Physical } from "three";
      const material = new Physical({ clearcoat: 2, sheenRoughness: -1, ior: 3 });
      material.transmission = -0.1;
      material.iridescenceIOR = 0.5;
    `;
    expect(runRule(threeValidPhysicalMaterialProperties, code).diagnostics).toHaveLength(5);
  });

  it("allows valid, dynamic, standard, and unrelated materials", () => {
    const code = `
      import { MeshPhysicalMaterial, MeshStandardMaterial } from "three";
      import { MeshPhysicalMaterial as Other } from "material-kit";
      new MeshPhysicalMaterial({ clearcoat: 1, sheen: 0, ior: 1.5 });
      new MeshPhysicalMaterial({ transmission, ior });
      new MeshStandardMaterial({ clearcoat: 2 });
      new Other({ clearcoat: 2 });
    `;
    expect(runRule(threeValidPhysicalMaterialProperties, code).diagnostics).toHaveLength(0);
  });
});
