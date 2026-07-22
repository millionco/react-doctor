import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireProjectionMatrixUpdate } from "./three-require-projection-matrix-update.js";

describe("three-require-projection-matrix-update", () => {
  it.each([
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     const resize = () => { camera.aspect = width / height; };`,
    `import * as THREE from "three";
     const camera = new THREE.OrthographicCamera();
     const zoom = () => { camera.zoom++; };`,
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     const resize = () => {
       camera.aspect = width / height;
       if (shouldRefresh) camera.updateProjectionMatrix();
     };`,
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     if (shouldResize) camera.aspect = width / height;`,
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     if (shouldResize) {
       camera.aspect = width / height;
       if (shouldRefresh) camera.updateProjectionMatrix();
     }`,
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     if (shouldResize) camera.aspect = width / height;
     else camera.updateProjectionMatrix();`,
  ])("flags projection changes without a matching update on every path", (code) => {
    expect(runRule(threeRequireProjectionMatrixUpdate, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     const resize = () => { camera.aspect = width / height; camera.updateProjectionMatrix(); };`,
    `import { OrthographicCamera } from "three";
     const camera = new OrthographicCamera();
     const resize = () => {
       camera.left = -width;
       if (wide) camera.updateProjectionMatrix(); else camera["updateProjectionMatrix"]();
     };`,
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     camera.aspect = width / height; camera.updateProjectionMatrix();`,
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     if (shouldResize) {
       camera.aspect = width / height;
       camera.updateProjectionMatrix();
     }`,
    `import { PerspectiveCamera } from "three";
     const camera = new PerspectiveCamera();
     if (shouldResize) camera.aspect = width / height;
     camera.updateProjectionMatrix();`,
    `import { PerspectiveCamera } from "three"; import { refreshCamera } from "./camera";
     const camera = new PerspectiveCamera();
     const resize = () => { camera.aspect = width / height; refreshCamera(camera); };`,
    `const camera = createCamera(); const resize = () => { camera.aspect = width / height; };`,
    `import { Camera } from "three";
     const camera = new Camera(); const resize = () => { camera.aspect = width / height; };`,
  ])("allows complete updates or unproven projection cameras", (code) => {
    expect(runRule(threeRequireProjectionMatrixUpdate, code).diagnostics).toHaveLength(0);
  });
});
