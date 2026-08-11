import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireControlsUpdate } from "./three-require-controls-update.js";

describe("three-require-controls-update", () => {
  it("reports damping or auto-rotation without a frame update", () => {
    const code = `
      import * as THREE from "three";
      import { OrbitControls } from "three/addons/controls/OrbitControls.js";
      const renderer = new THREE.WebGLRenderer();
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      renderer.setAnimationLoop(() => renderer.render(scene, camera));
    `;
    expect(runRule(threeRequireControlsUpdate, code).diagnostics).toHaveLength(1);
  });

  it("allows controls updated by Three.js and R3F frame loops", () => {
    const code = `
      import * as THREE from "three";
      import { MapControls } from "three/examples/jsm/controls/MapControls.js";
      import { useFrame } from "@react-three/fiber";
      const renderer = new THREE.WebGLRenderer();
      const first = new MapControls(camera, renderer.domElement);
      first.autoRotate = true;
      renderer.setAnimationLoop(() => { first.update(); renderer.render(scene, camera); });
      const Scene = () => {
        const second = new MapControls(camera, renderer.domElement);
        second.enableDamping = true;
        useFrame(() => second.update());
        return null;
      };
    `;
    expect(runRule(threeRequireControlsUpdate, code).diagnostics).toHaveLength(0);
  });

  it("allows inactive, externally managed, and loopless controls", () => {
    const code = `
      import { OrbitControls } from "three-stdlib";
      const inactive = new OrbitControls(camera, element);
      inactive.enableDamping = false;
      const external = new OrbitControls(camera, element);
      external.enableDamping = true;
      configure(external);
      const loopless = new OrbitControls(camera, element);
      loopless.autoRotate = true;
    `;
    expect(runRule(threeRequireControlsUpdate, code).diagnostics).toHaveLength(0);
  });
});
