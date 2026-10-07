import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeValidSpotLightProperties } from "./three-valid-spot-light-properties.js";

describe("three-valid-spot-light-properties", () => {
  it("reports invalid constructor and assigned cone properties", () => {
    const code = `
      import { SpotLight } from "three";
      new SpotLight(0xffffff, 1, 0, 2, -0.1);
      const light = new SpotLight();
      light.angle = 0;
      light.penumbra = 2;
    `;
    expect(runRule(threeValidSpotLightProperties, code).diagnostics).toHaveLength(4);
  });

  it("allows valid, dynamic, and unrelated spotlights", () => {
    const code = `
      import { SpotLight } from "three";
      import { SpotLight as Other } from "lighting-kit";
      new SpotLight(0xffffff, 1, 0, Math.PI / 3, 0.5);
      new SpotLight(0xffffff, 1, 0, angle, penumbra);
      new Other(0xffffff, 1, 0, 2, 2);
    `;
    expect(runRule(threeValidSpotLightProperties, code).diagnostics).toHaveLength(0);
  });
});
