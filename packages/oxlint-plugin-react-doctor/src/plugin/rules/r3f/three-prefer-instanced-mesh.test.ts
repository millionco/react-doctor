import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threePreferInstancedMesh } from "./three-prefer-instanced-mesh.js";

describe("three-prefer-instanced-mesh", () => {
  it("reports repeated Mesh construction with shared resources", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh as ThreeMesh } from "three";
       import * as THREE from "three";
       [0, 1].map(() => new ThreeMesh(geometry, material));
       [0, 1, 2].map(() => new THREE.Mesh(geometry, material));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports exact local callbacks used by repeated maps", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh } from "three";
       const createMesh = (index) => new Mesh(geometry, material);
       [0, 1].map(createMesh);
       function buildMesh(index) { return new Mesh(geometry, material); }
       [0, 1].map(buildMesh);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports transparent TypeScript resource references", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh } from "three";
       [0, 1].map(() => new Mesh(geometry!, material as Material));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows per-item geometry and material", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh } from "three";
       [first, second].map((item) => new Mesh(item.geometry, material));
       [first, second].map((item) => new Mesh(geometry, item.material));
       [first, second].map((item) => new Mesh(geometry, materials[item.kind]));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows unknown, singleton, conditional, and incomplete repetitions", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh } from "three";
       items.map(() => new Mesh(geometry, material));
       [0].map(() => new Mesh(geometry, material));
       [0, 1].map(() => enabled ? new Mesh(geometry, material) : null);
       [0, 1].map(() => new Mesh(geometry));
       const mesh = new Mesh(geometry, material);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows resource bindings reassigned by the map callback", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh } from "three";
       let geometry = firstGeometry;
       [0, 1].map((index) => {
         geometry = createGeometry(index);
         return new Mesh(geometry, material);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires proven Three.js Mesh provenance", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh as UiMesh } from "mesh-library";
       [0, 1].map(() => new UiMesh(geometry, material));
       const THREE = { Mesh: UiMesh };
       [0, 1].map(() => new THREE.Mesh(geometry, material));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
