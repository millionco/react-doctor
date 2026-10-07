import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireShadowsEnabled } from "./three-require-shadows-enabled.js";

describe("three-require-shadows-enabled", () => {
  it("reports shadow objects rendered without renderer shadow maps", () => {
    const code = `
      import { Mesh, Scene, PerspectiveCamera, WebGLRenderer } from "three";
      const renderer = new WebGLRenderer();
      const scene = new Scene();
      const camera = new PerspectiveCamera();
      const mesh = new Mesh();
      mesh.castShadow = true;
      scene.add(mesh);
      renderer.render(scene, camera);
    `;
    expect(runRule(threeRequireShadowsEnabled, code).diagnostics).toHaveLength(1);
  });

  it("allows shadow maps enabled on the rendering renderer", () => {
    const code = `
      import * as THREE from "three";
      const renderer = new THREE.WebGLRenderer();
      const mesh = new THREE.Mesh();
      renderer.shadowMap.enabled = true;
      mesh.receiveShadow = true;
      renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
    `;
    expect(runRule(threeRequireShadowsEnabled, code).diagnostics).toHaveLength(0);
  });

  it("ignores unrelated objects and owners without a local render", () => {
    const code = `
      const object = { castShadow: false };
      object.castShadow = true;
      import { Mesh } from "three";
      const mesh = new Mesh();
      mesh.castShadow = true;
    `;
    expect(runRule(threeRequireShadowsEnabled, code).diagnostics).toHaveLength(0);
  });
});
