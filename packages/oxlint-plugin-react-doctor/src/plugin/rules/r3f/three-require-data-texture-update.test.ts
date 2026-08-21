import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireDataTextureUpdate } from "./three-require-data-texture-update.js";

describe("three-require-data-texture-update", () => {
  it.each([
    `import { DataTexture, WebGLRenderer } from "three"; const texture = new DataTexture(new Uint8Array(16), 2, 2); const renderer = new WebGLRenderer(); renderer.setAnimationLoop(() => { texture.image.data[0] = 255; renderer.render(scene, camera); });`,
    `import * as THREE from "three"; const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2); const pixels = texture.image.data; const renderer = new THREE.WebGLRenderer(); renderer.setAnimationLoop(() => { pixels.fill(0); renderer.render(scene, camera); });`,
    `import { DataArrayTexture, WebGLRenderer } from "three"; const texture = new DataArrayTexture(new Uint8Array(32), 2, 2, 2); const renderer = new WebGLRenderer(); renderer.setAnimationLoop(() => { texture.image = nextImage; renderer.render(scene, camera); });`,
  ])("reports repeated data-texture changes without an upload flag", (code) => {
    expect(runRule(threeRequireDataTextureUpdate, code).diagnostics).toHaveLength(1);
  });

  it.each([
    [
      `import { DataTexture, WebGLRenderer } from "three"; const texture = new DataTexture(new Uint8Array(16), 2, 2); const renderer = new WebGLRenderer(); renderer.setAnimationLoop(() => { texture.image.data[0] = 255; texture.needsUpdate = true; renderer.render(scene, camera); });`,
      0,
    ],
    [
      `import { DataTexture, WebGLRenderer } from "three"; const first = new DataTexture(new Uint8Array(16), 2, 2); const second = new DataTexture(new Uint8Array(16), 2, 2); const renderer = new WebGLRenderer(); renderer.setAnimationLoop(() => { first.image.data.set(nextPixels); second.needsUpdate = true; renderer.render(scene, camera); });`,
      1,
    ],
    [`class DataTexture {} const texture = new DataTexture(); texture.image.data[0] = 1;`, 0],
  ])("keeps covered, mismatched, and unrelated mutations precise", (code, count) => {
    expect(runRule(threeRequireDataTextureUpdate, code).diagnostics).toHaveLength(count);
  });
});
