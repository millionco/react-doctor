import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireInstancedBufferUpdate } from "./three-require-instanced-buffer-update.js";

describe("three-require-instanced-buffer-update", () => {
  it.each([
    `import { InstancedMesh } from "three";
     const mesh = new InstancedMesh(geometry, material, count);
     const update = () => { mesh.setMatrixAt(0, matrix); };`,
    `import * as THREE from "three";
     const mesh = new THREE.InstancedMesh(geometry, material, count);
     const update = () => { mesh.setColorAt(0, color); mesh.instanceMatrix.needsUpdate = true; };`,
    `import { InstancedMesh } from "three";
     const mesh = new InstancedMesh(geometry, material, count);
     const update = () => {
       mesh.setMatrixAt(0, matrix);
       if (shouldUpload) mesh.instanceMatrix.needsUpdate = true;
     };`,
  ])("flags missing or mismatched instance-buffer uploads", (code) => {
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { InstancedMesh } from "three";
     const mesh = new InstancedMesh(geometry, material, count);
     const update = () => { mesh.setMatrixAt(0, matrix); mesh.instanceMatrix.needsUpdate = true; };`,
    `import { InstancedMesh } from "three";
     const mesh = new InstancedMesh(geometry, material, count);
     const update = () => {
       mesh.setColorAt(0, color);
       if (fast) mesh.instanceColor.needsUpdate = true;
       else mesh.instanceColor.needsUpdate = true;
     };`,
    `import { InstancedMesh } from "three";
     const mesh = new InstancedMesh(geometry, material, count);
     mesh.setMatrixAt(0, matrix); mesh.instanceMatrix.needsUpdate = true;`,
    `import { InstancedMesh } from "three"; import { uploadInstances } from "./gpu";
     const mesh = new InstancedMesh(geometry, material, count);
     const update = () => { mesh.setMatrixAt(0, matrix); uploadInstances(mesh); };`,
    `const mesh = createMesh(); const update = () => { mesh.setMatrixAt(0, matrix); };`,
  ])("allows matching uploads on every path or unproven meshes", (code) => {
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });
});
