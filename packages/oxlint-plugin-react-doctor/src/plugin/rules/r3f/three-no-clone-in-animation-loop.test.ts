import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoCloneInAnimationLoop } from "./three-no-clone-in-animation-loop.js";

describe("three-no-clone-in-animation-loop", () => {
  it.each([
    `import { WebGLRenderer, Vector3 } from "three"; const renderer = new WebGLRenderer(); const position = new Vector3(); renderer.setAnimationLoop(() => position.clone());`,
    `import * as THREE from "three"; const renderer = new THREE.WebGLRenderer(); const mesh = new THREE.Mesh(); const frame = () => { mesh.position.clone(); renderer.render(scene, camera); requestAnimationFrame(frame); }; requestAnimationFrame(frame);`,
  ])("flags proven Three.js clones in direct animation loops", (code) => {
    expect(runRule(threeNoCloneInAnimationLoop, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { WebGLRenderer, Vector3 } from "three"; const renderer = new WebGLRenderer(); const position = new Vector3(); renderer.setAnimationLoop(() => { if (capture) position.clone(); });`,
    `import { WebGLRenderer } from "three"; const renderer = new WebGLRenderer(); renderer.setAnimationLoop(() => unknown.clone());`,
    `import { Vector3 } from "three"; const position = new Vector3(); requestAnimationFrame(() => position.clone());`,
  ])("ignores conditional, unproven, and one-shot clones", (code) => {
    expect(runRule(threeNoCloneInAnimationLoop, code).diagnostics).toHaveLength(0);
  });
});
