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

  it("requires morph texture uploads after setMorphAt", () => {
    const missing = `
      import { InstancedMesh } from "three";
      const mesh = new InstancedMesh(geometry, material, count);
      const update = () => mesh.setMorphAt(0, sourceMesh);
    `;
    const covered = `
      import { InstancedMesh } from "three";
      const mesh = new InstancedMesh(geometry, material, count);
      const update = () => {
        mesh.setMorphAt(0, sourceMesh);
        mesh.morphTexture.needsUpdate = true;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, missing).diagnostics).toHaveLength(1);
    expect(runRule(threeRequireInstancedBufferUpdate, covered).diagnostics).toHaveLength(0);
  });

  it("allows an upload after a synchronous iteration callback", () => {
    const code = `
      import { InstancedMesh } from "three";
      const mesh = new InstancedMesh(geometry, material, count);
      const update = () => {
        matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("allows a matching instance-color existence guard after setColorAt", () => {
    const code = `
      import { InstancedMesh } from "three";
      const mesh = new InstancedMesh(geometry, material, count);
      const update = () => {
        mesh.setColorAt(0, color);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("allows an upload guarded by a mutation flag", () => {
    const code = `
      import { InstancedMesh } from "three";
      const mesh = new InstancedMesh(geometry, material, count);
      const update = () => {
        let dirty = false;
        for (const entry of entries) {
          if (!entry.visible) continue;
          mesh.setColorAt(entry.index, entry.color);
          dirty = true;
        }
        if (dirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("does not trust a mutation flag that is not set on every path after the mutation", () => {
    const code = `
      import { InstancedMesh } from "three";
      const mesh = new InstancedMesh(geometry, material, count);
      const update = () => {
        let dirty = false;
        for (const entry of entries) {
          mesh.setColorAt(entry.index, entry.color);
          if (entry.skipUpload) continue;
          dirty = true;
        }
        if (dirty && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("allows uploads through a for-of alias over a static mesh list", () => {
    const code = `
      import { InstancedMesh } from "three";
      const bodies = new InstancedMesh(geometry, material, count);
      const caps = new InstancedMesh(geometry, material, count);
      const update = () => {
        bodies.setMatrixAt(0, matrix);
        caps.setMatrixAt(0, matrix);
        for (const mesh of [bodies, caps]) mesh.instanceMatrix.needsUpdate = true;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("does not let an unrelated mesh-list alias cover a mutation", () => {
    const code = `
      import { InstancedMesh } from "three";
      const changed = new InstancedMesh(geometry, material, count);
      const other = new InstancedMesh(geometry, material, count);
      const update = () => {
        changed.setMatrixAt(0, matrix);
        for (const mesh of [other]) mesh.instanceMatrix.needsUpdate = true;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("allows initial instance data populated before a new mesh escapes", () => {
    const code = `
      import { InstancedMesh } from "three";
      const createMesh = () => {
        const mesh = new InstancedMesh(geometry, material, count);
        matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.castShadow = true;
        scene.add(mesh);
        return mesh;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("requires an upload when a previously escaped mesh is mutated", () => {
    const code = `
      import { InstancedMesh } from "three";
      const createMesh = () => {
        const mesh = new InstancedMesh(geometry, material, count);
        scene.add(mesh);
        mesh.setMatrixAt(0, matrix);
        return mesh;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("allows a caller to upload mutations made by a local helper", () => {
    const code = `
      import { InstancedMesh } from "three";
      const mesh = new InstancedMesh(geometry, material, count);
      scene.add(mesh);
      const setSlot = (index, matrix) => mesh.setMatrixAt(index, matrix);
      const update = () => {
        for (let index = 0; index < count; index++) setSlot(index, matrices[index]);
        mesh.instanceMatrix.needsUpdate = true;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("requires every local-helper call site to upload the mutation", () => {
    const code = `
      import { InstancedMesh } from "three";
      const mesh = new InstancedMesh(geometry, material, count);
      scene.add(mesh);
      const setSlot = (index, matrix) => mesh.setMatrixAt(index, matrix);
      const covered = () => { setSlot(0, first); mesh.instanceMatrix.needsUpdate = true; };
      const uncovered = () => { setSlot(1, second); };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("keeps initialization safe after attaching a new mesh to a local Three group", () => {
    const code = `
      import { Group, InstancedMesh } from "three";
      const createMesh = () => {
        const group = new Group();
        const mesh = new InstancedMesh(geometry, material, count);
        group.add(mesh);
        mesh.setColorAt(0, color);
        return group;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("keeps initialization safe through a nonescaping same-class helper", () => {
    const code = `
      import { InstancedMesh } from "three";
      class SceneBuilder {
        create() {
          const mesh = new InstancedMesh(geometry, material, count);
          this.setSlot(mesh, 0, matrix);
          mesh.setMatrixAt(1, matrix);
          return mesh;
        }
        setSlot(mesh, index, matrix) {
          mesh.setMatrixAt(index, matrix);
        }
      }
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("does not trust a same-class helper that lets the mesh escape", () => {
    const code = `
      import { InstancedMesh } from "three";
      class SceneBuilder {
        create() {
          const mesh = new InstancedMesh(geometry, material, count);
          this.publish(mesh);
          mesh.setMatrixAt(0, matrix);
          return mesh;
        }
        publish(mesh) {
          registry.mesh = mesh;
        }
      }
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("does not treat an arbitrary collection add as pre-render initialization", () => {
    const code = `
      import { InstancedMesh } from "three";
      const createMesh = (registry) => {
        const mesh = new InstancedMesh(geometry, material, count);
        registry.add(mesh);
        mesh.setColorAt(0, color);
        return mesh;
      };
    `;
    expect(runRule(threeRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });
});
