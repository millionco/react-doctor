import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threePreferInstancedMesh } from "./three-prefer-instanced-mesh.js";

describe("three-prefer-instanced-mesh", () => {
  it("reports repeated Mesh construction with shared resources", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh as ThreeMesh, Scene } from "three";
       import * as THREE from "three";
       const firstScene = new Scene();
       const secondScene = new THREE.Scene();
       firstScene.add(...[0, 1].map(() => new ThreeMesh(geometry, material)));
       secondScene.add(...[0, 1, 2].map(() => new THREE.Mesh(geometry, material)));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports exact local callbacks used by repeated maps", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       const createMesh = (index) => new Mesh(geometry, material);
       scene.add(...[0, 1].map(createMesh));
       function buildMesh(index) { return new Mesh(geometry, material); }
       scene.add(...[0, 1].map(buildMesh));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports a Mesh returned through a local callback binding", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       scene.add(...[0, 1].map(() => {
         const mesh = new Mesh(geometry, material);
         return mesh;
       }));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports repeated mesh arrays stored in a local binding before being added", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       const meshes = [0, 1].map(() => new Mesh(geometry, material));
       scene.add(...meshes);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a returned mesh binding added inside every callback execution", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       [0, 1].map(() => {
         const mesh = new Mesh(geometry, material);
         scene.add(mesh);
         return mesh;
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports transparent TypeScript resource references", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       scene.add(...[0, 1].map(() => new Mesh(geometry!, material as Material)));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports data properties from a local resource object", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       const resources = { geometry, material };
       scene.add(...[0, 1].map(() => new Mesh(resources.geometry, resources.material)));`,
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

  it("allows resource members reassigned by the map callback", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       const resources = { geometry: firstGeometry, material };
       scene.add(...[0, 1].map((index) => {
         resources.geometry = createGeometry(index);
         return new Mesh(resources.geometry, resources.material);
       }));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows repeated Mesh construction that is not added to a Three object", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh } from "three";
       const collisionSamples = [0, 1].map(() => new Mesh(geometry, material));
       collisionSamples.forEach((mesh) => mesh.geometry.computeBoundingBox());`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports meshes directly added during every repeated callback execution", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       [0, 1].map(() => scene.add(new Mesh(geometry, material)));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a mesh binding added only on a conditional callback path", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       [0, 1].map((index) => {
         const mesh = new Mesh(geometry, material);
         if (index > 0) scene.add(mesh);
         return mesh;
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports returned meshes with per-instance transform updates", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       scene.add(...[0, 1].map((index) => {
         const mesh = new Mesh(geometry, material);
         mesh.position.x = index;
         return mesh;
       }));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows Mesh objects that are not returned by the added map", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Group, Mesh, Scene } from "three";
       const scene = new Scene();
       scene.add(...[0, 1].map(() => {
         const collisionSample = new Mesh(geometry, material);
         collisionSample.geometry.computeBoundingBox();
         return new Group();
       }));
       scene.add(...[0, 1].map(() => new Mesh(geometry, material).add(new Group())));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows local resource getters that can return a fresh value per access", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       const resources = {
         get geometry() { return createGeometry(); },
         material,
       };
       scene.add(...[0, 1].map(() => new Mesh(resources.geometry, resources.material)));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows nested local resource getters that can return a fresh value per access", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       const meshResources = {
         get geometry() { return createGeometry(); },
       };
       const resources = { mesh: meshResources, material };
       scene.add(...[0, 1].map(() => new Mesh(resources.mesh.geometry, resources.material)));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows resource members reached through an alias that is mutated by the callback", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Scene } from "three";
       const scene = new Scene();
       const resources = { geometry: firstGeometry, material };
       scene.add(...[0, 1].map((index) => {
         const mutableResources = resources;
         mutableResources.geometry = createGeometry(index);
         return new Mesh(resources.geometry, resources.material);
       }));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows resources and mesh semantics mutated by invoked local helpers", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Object3D, Scene } from "three";
       const scene = new Scene();
       const resources = { geometry: firstGeometry, material };
       scene.add(...[0, 1].map((index) => {
         const updateResources = () => {
           resources.geometry = createGeometry(index);
         };
         updateResources();
         return new Mesh(resources.geometry, resources.material);
       }));
       scene.add(...[0, 1].map(() => {
         const mesh = new Mesh(geometry, material);
         const addChild = () => mesh.add(new Object3D());
         addChild();
         return mesh;
       }));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows returned meshes whose geometry or object semantics change after construction", () => {
    const result = runRule(
      threePreferInstancedMesh,
      `import { Mesh, Object3D, Scene } from "three";
       const scene = new Scene();
       scene.add(...[0, 1].map((index) => {
         const mesh = new Mesh(geometry, material);
         mesh.geometry = createGeometry(index);
         return mesh;
       }));
       scene.add(...[0, 1].map(() => {
         const mesh = new Mesh(geometry, material);
         mesh.add(new Object3D());
         return mesh;
       }));`,
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
