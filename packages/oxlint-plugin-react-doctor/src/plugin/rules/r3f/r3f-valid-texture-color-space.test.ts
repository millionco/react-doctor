import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidTextureColorSpace } from "./r3f-valid-texture-color-space.js";

describe("r3f-valid-texture-color-space", () => {
  it("reports explicit color-space tags incompatible with material map semantics", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { NoColorSpace, SRGBColorSpace, Texture } from "three";
      const color = new Texture();
      color.colorSpace = NoColorSpace;
      const normal = new Texture();
      normal.colorSpace = SRGBColorSpace;
      export const Scene = () => <Canvas>
        <meshPhysicalMaterial map={color} emissiveMap={color} normalMap={normal} />
      </Canvas>;
    `;
    expect(runRule(r3fValidTextureColorSpace, code).diagnostics).toHaveLength(3);
  });

  it("allows compatible, dynamic, reassigned, spread, and custom component maps", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import * as THREE from "three";
      const color = new THREE.Texture();
      color.colorSpace = THREE.SRGBColorSpace;
      const data = new THREE.Texture();
      data.colorSpace = THREE.NoColorSpace;
      const corrected = new THREE.Texture();
      corrected.colorSpace = THREE.NoColorSpace;
      corrected.colorSpace = THREE.SRGBColorSpace;
      export const Scene = (props) => <Canvas>
        <meshStandardMaterial map={color} normalMap={data} />
        <meshStandardMaterial map={dynamicTexture} />
        <meshStandardMaterial {...props} map={corrected} />
        <CustomMaterial map={data} />
      </Canvas>;
    `;
    expect(runRule(r3fValidTextureColorSpace, code).diagnostics).toHaveLength(0);
  });
});
