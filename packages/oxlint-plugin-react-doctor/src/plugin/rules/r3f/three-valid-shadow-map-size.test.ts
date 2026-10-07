import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidShadowMapSize } from "./three-valid-shadow-map-size.js";

describe("three-valid-shadow-map-size", () => {
  it("reports non-power-of-two and nonpositive dimensions", () => {
    const code = `
      import { DirectionalLight, PointLight } from "three";
      const directional = new DirectionalLight();
      const point = new PointLight();
      directional.shadow.mapSize.set(1000, 1024);
      point.shadow.mapSize.set(0, -512);
    `;
    expect(runRule(threeValidShadowMapSize, code).diagnostics).toHaveLength(3);
  });

  it("allows powers of two, dynamic sizes, and unrelated objects", () => {
    const code = `
      import { SpotLight } from "three";
      const light = new SpotLight();
      light.shadow.mapSize.set(1024, 2048);
      light.shadow.mapSize.set(width, height);
      custom.shadow.mapSize.set(1000, 1000);
    `;
    expect(runRule(threeValidShadowMapSize, code).diagnostics).toHaveLength(0);
  });
});
