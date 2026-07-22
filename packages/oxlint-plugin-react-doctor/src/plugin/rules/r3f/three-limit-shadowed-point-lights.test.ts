import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeLimitShadowedPointLights } from "./three-limit-shadowed-point-lights.js";

describe("three-limit-shadowed-point-lights", () => {
  it("flags the third shadowed point light added to one scene", () => {
    const result = runRule(
      threeLimitShadowedPointLights,
      `import { PointLight, Scene } from "three";
       const scene = new Scene();
       const firstLight = new PointLight(); firstLight.castShadow = true; scene.add(firstLight);
       const secondLight = new PointLight(); secondLight.castShadow = true; scene.add(secondLight);
       const thirdLight = new PointLight(); thirdLight.castShadow = true; scene.add(thirdLight);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows namespace imports and stable aliases", () => {
    const result = runRule(
      threeLimitShadowedPointLights,
      `import * as THREE from "three";
       const scene = new THREE.Scene();
       const first = new THREE.PointLight(); const second = new THREE.PointLight();
       const third = new THREE.PointLight(); const alias = third;
       first.castShadow = true; second.castShadow = true; alias.castShadow = true;
       scene.add(first); scene.add(second); scene.add(alias);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("counts every point light in one Scene.add call", () => {
    const result = runRule(
      threeLimitShadowedPointLights,
      `import { PointLight, Scene } from "three";
       const scene = new Scene();
       const first = new PointLight(); const second = new PointLight(); const third = new PointLight();
       first.castShadow = true; second.castShadow = true; third.castShadow = true;
       scene.add(first, second, third);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `import { PointLight, Scene } from "three";
     const scene = new Scene();
     const first = new PointLight(); const second = new PointLight();
     first.castShadow = true; second.castShadow = true; scene.add(first, second);`,
    `import { PointLight, Scene } from "three";
     const firstScene = new Scene(); const secondScene = new Scene();
     const first = new PointLight(); const second = new PointLight(); const third = new PointLight();
     first.castShadow = true; second.castShadow = true; third.castShadow = true;
     firstScene.add(first); firstScene.add(second); secondScene.add(third);`,
    `import { PointLight, Scene } from "three";
     const scene = new Scene();
     const first = new PointLight(); const second = new PointLight(); const third = new PointLight();
     first.castShadow = true; second.castShadow = true; third.castShadow = true;
     scene.add(first); scene.add(second); if (debug) scene.add(third);`,
    `const scene = createScene();
     const first = createLight(); const second = createLight(); const third = createLight();
     first.castShadow = true; second.castShadow = true; third.castShadow = true;
     scene.add(first); scene.add(second); scene.add(third);`,
  ])("allows setups that do not prove three shadowed point lights in one scene", (code) => {
    expect(runRule(threeLimitShadowedPointLights, code).diagnostics).toHaveLength(0);
  });
});
