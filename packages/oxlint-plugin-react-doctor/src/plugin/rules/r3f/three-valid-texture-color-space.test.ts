import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidTextureColorSpace } from "./three-valid-texture-color-space.js";

describe("three-valid-texture-color-space", () => {
  it("reports explicit color-space tags incompatible with material map semantics", () => {
    const code = `
      import { MeshPhysicalMaterial, NoColorSpace, SRGBColorSpace, Texture } from "three";
      const color = new Texture();
      color.colorSpace = NoColorSpace;
      const normal = new Texture();
      normal.colorSpace = SRGBColorSpace;
      new MeshPhysicalMaterial({ map: color, emissiveMap: color, normalMap: normal });
    `;
    expect(runRule(threeValidTextureColorSpace, code).diagnostics).toHaveLength(3);
  });

  it("allows compatible, dynamic, reassigned, custom, and unconsumed textures", () => {
    const code = `
      import * as THREE from "three";
      const color = new THREE.Texture();
      color.colorSpace = THREE.SRGBColorSpace;
      const data = new THREE.Texture();
      data.colorSpace = THREE.NoColorSpace;
      const corrected = new THREE.Texture();
      corrected.colorSpace = THREE.NoColorSpace;
      corrected.colorSpace = THREE.SRGBColorSpace;
      const unused = new THREE.Texture();
      unused.colorSpace = THREE.NoColorSpace;
      new THREE.MeshStandardMaterial({ map: color, normalMap: data });
      new CustomMaterial({ map: unused });
      new THREE.MeshStandardMaterial({ map: dynamicTexture });
      new THREE.MeshStandardMaterial({ map: corrected });
    `;
    expect(runRule(threeValidTextureColorSpace, code).diagnostics).toHaveLength(0);
  });
});
