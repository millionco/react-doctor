import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireEnvironmentForMetal } from "./three-require-environment-for-metal.js";

describe("three-require-environment-for-metal", () => {
  it.each([
    `import { DirectionalLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ metalness: 1 })));
     scene.add(new DirectionalLight());
     new WebGLRenderer().render(scene, new PerspectiveCamera());`,
    `import * as THREE from "three";
     const scene = new THREE.Scene();
     const material = new THREE.MeshPhysicalMaterial();
     material.metalness = 0.75;
     scene.add(new THREE.Mesh(geometry, material));
     const renderer = new THREE.WebGLRenderer();
     renderer.render(scene, camera);`,
  ])(
    "reports strongly metallic materials in a closed rendered scene without environment",
    (code) => {
      expect(runRule(threeRequireEnvironmentForMetal, code).diagnostics).toHaveLength(1);
    },
  );

  it.each([
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene(); scene.environment = environment;
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ metalness: 1 })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ metalness: 1, envMap: environment })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ metalness: 0.5 })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(importedModel, new Mesh(geometry, new MeshStandardMaterial({ metalness: 1 })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     const material = new MeshStandardMaterial({ metalness: 1, ...options });
     scene.add(new Mesh(geometry, material));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     if (shouldShowMesh) scene.add(new Mesh(geometry, new MeshStandardMaterial({ metalness: 1 })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     const material = new MeshStandardMaterial();
     scene.add(new Mesh(geometry, material));
     new WebGLRenderer().render(scene, camera);
     material.metalness = 1;`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ metalness: 1, visible: false })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ metalness: 1, transparent: true, opacity: 0 })));
     new WebGLRenderer().render(scene, camera);`,
  ])("keeps environmental, weak, and open rendered-scene contracts quiet", (code) => {
    expect(runRule(threeRequireEnvironmentForMetal, code).diagnostics).toHaveLength(0);
  });
});
