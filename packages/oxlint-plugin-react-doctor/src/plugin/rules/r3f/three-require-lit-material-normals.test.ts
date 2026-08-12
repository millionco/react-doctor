import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireLitMaterialNormals } from "./three-require-lit-material-normals.js";

describe("three-require-lit-material-normals", () => {
  it.each([
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture() }));`,
    `import * as THREE from "three";
     const source = new THREE.BufferGeometry();
     const geometry = source;
     geometry.setIndex(indices);
     geometry.setAttribute(\`position\`, new THREE.Float32BufferAttribute(positions, 3));
     const material = new THREE.MeshPhongMaterial();
     material.normalMap = new THREE.Texture();
     new THREE.Mesh(geometry, material);`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const mesh = new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture() }));
     mesh.visible = false;
     mesh.visible = true;`,
  ])("reports closed custom geometry without normals", (code) => {
    expect(runRule(threeRequireLitMaterialNormals, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     geometry.setAttribute("normal", new BufferAttribute(normals, 3));
     new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshPhysicalMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     geometry.computeVertexNormals();
     new Mesh(geometry, new MeshPhysicalMaterial({ normalMap: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshStandardMaterial());`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshBasicMaterial());`,
    `import { BufferGeometry, Mesh, MeshStandardMaterial } from "three";
     const geometry = new BufferGeometry();
     configureGeometry(geometry);
     new Mesh(geometry, new MeshStandardMaterial());`,
    `import { BufferGeometry, Mesh, MeshStandardMaterial } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute(attributeName, attribute);
     new Mesh(geometry, new MeshStandardMaterial());`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     if (hasPositions) geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const material = new MeshStandardMaterial();
     if (hasNormalMap) material.normalMap = new Texture();
     new Mesh(geometry, material);`,
    `import { Mesh, MeshStandardMaterial } from "three";
     new Mesh(importedGeometry, new MeshStandardMaterial());`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture(), visible: false }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const mesh = new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture() }));
     mesh.visible = false;`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const mesh = new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture() }));
     if (shouldHide) mesh.visible = false;`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const mesh = new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture() }));
     for (const item of items) mesh.visible = false;`,
    `import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new ShaderMaterial());`,
  ])("keeps valid and unresolved geometry contracts quiet", (code) => {
    expect(runRule(threeRequireLitMaterialNormals, code).diagnostics).toHaveLength(0);
  });

  it("respects Three.js import provenance", () => {
    const result = runRule(
      threeRequireLitMaterialNormals,
      `class BufferGeometry {}
       class MeshStandardMaterial {}
       class Mesh {}
       const geometry = new BufferGeometry();
       geometry.setAttribute("position", positions);
       new Mesh(geometry, new MeshStandardMaterial());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
