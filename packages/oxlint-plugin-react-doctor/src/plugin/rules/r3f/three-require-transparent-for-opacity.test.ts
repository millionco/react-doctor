import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireTransparentForOpacity } from "./three-require-transparent-for-opacity.js";

describe("three-require-transparent-for-opacity", () => {
  it("reports opacity below one without an active transparency mode", () => {
    const code = `
      import { MeshBasicMaterial, MeshStandardMaterial } from "three";
      new MeshBasicMaterial({ opacity: 0.5 });
      new MeshStandardMaterial({ opacity: 0.2, transparent: false });
    `;
    expect(runRule(threeRequireTransparentForOpacity, code).diagnostics).toHaveLength(2);
  });

  it("allows active, opaque, dynamic, and spread configurations", () => {
    const code = `
      import * as THREE from "three";
      new THREE.MeshBasicMaterial({ opacity: 0.5, transparent: true });
      new THREE.MeshBasicMaterial({ opacity: 0.5, alphaHash: true });
      new THREE.MeshBasicMaterial({ opacity: 0.5, alphaTest: 0.1 });
      new THREE.MeshBasicMaterial({ opacity: 1 });
      new THREE.MeshBasicMaterial({ opacity });
      new THREE.MeshBasicMaterial({ opacity: 0.5, transparent });
      new THREE.MeshBasicMaterial({ ...props, opacity: 0.5 });
    `;
    expect(runRule(threeRequireTransparentForOpacity, code).diagnostics).toHaveLength(0);
  });
});
