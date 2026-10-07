import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireUvForTextureMap } from "./three-require-uv-for-texture-map.js";

describe("three-require-uv-for-texture-map", () => {
  it.each([
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const material = new MeshStandardMaterial({ map: new Texture() });
     new Mesh(geometry, material);`,
    `import * as THREE from "three";
     const geometry = new THREE.BufferGeometry();
     geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
     const material = new THREE.MeshPhongMaterial();
     material.normalMap = new THREE.Texture();
     new THREE.Mesh(geometry, material);`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshPhysicalMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshPhysicalMaterial({ anisotropyMap: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const mesh = new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }));
     mesh.visible = false;
     mesh.visible = true;`,
  ])("reports closed mapped geometry without UVs", (code) => {
    expect(runRule(threeRequireUvForTextureMap, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
     new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     geometry.setAttribute("uv2", new BufferAttribute(uvs, 2));
     new Mesh(geometry, new MeshStandardMaterial({ aoMap: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshStandardMaterial({ map: null }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshStandardMaterial({ map: new Texture(), ...options }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshBasicMaterial({ normalMap: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshToonMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshToonMaterial({ gradientMap: new Texture() }));`,
    `import { BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     configureGeometry(geometry);
     new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     if (hasPositions) geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const material = new MeshStandardMaterial();
     if (hasMap) material.map = new Texture();
     new Mesh(geometry, material);`,
    `import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new ShaderMaterial({ uniforms: { map: { value: new Texture() } } }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     new Mesh(geometry, new MeshStandardMaterial({ map: new Texture(), transparent: true, opacity: 0 }));`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const mesh = new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }));
     mesh.visible = false;`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const mesh = new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }));
     if (shouldHide) mesh.visible = false;`,
    `import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";
     const geometry = new BufferGeometry();
     geometry.setAttribute("position", new BufferAttribute(positions, 3));
     const mesh = new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }));
     while (shouldHide()) mesh.visible = false;`,
  ])("keeps valid, channel-aware, and unresolved map contracts quiet", (code) => {
    expect(runRule(threeRequireUvForTextureMap, code).diagnostics).toHaveLength(0);
  });
});
