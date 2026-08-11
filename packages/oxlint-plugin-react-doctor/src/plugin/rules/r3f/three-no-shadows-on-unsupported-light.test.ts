import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoShadowsOnUnsupportedLight } from "./three-no-shadows-on-unsupported-light.js";

describe("three-no-shadows-on-unsupported-light", () => {
  it("reports ambient and hemisphere lights configured to cast shadows", () => {
    const code = `
      import { AmbientLight, HemisphereLight as SkyLight } from "three";
      const ambient = new AmbientLight();
      const sky = new SkyLight();
      ambient.castShadow = true;
      sky.castShadow = true;
    `;
    expect(runRule(threeNoShadowsOnUnsupportedLight, code).diagnostics).toHaveLength(2);
  });

  it("allows supported, disabled, dynamic, and unrelated objects", () => {
    const code = `
      import * as THREE from "three";
      const directional = new THREE.DirectionalLight();
      const ambient = new THREE.AmbientLight();
      directional.castShadow = true;
      ambient.castShadow = false;
      ambient.castShadow = enabled;
      object.castShadow = true;
    `;
    expect(runRule(threeNoShadowsOnUnsupportedLight, code).diagnostics).toHaveLength(0);
  });
});
