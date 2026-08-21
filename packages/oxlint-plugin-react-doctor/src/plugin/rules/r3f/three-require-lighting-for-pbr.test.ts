import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeRequireLightingForPbr } from "./three-require-lighting-for-pbr.js";

describe("three-require-lighting-for-pbr", () => {
  it.each([
    `import { Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial()));
     new WebGLRenderer().render(scene, new PerspectiveCamera());`,
    `import * as THREE from "three";
     const scene = new THREE.Scene();
     const material = new THREE.MeshPhysicalMaterial();
     scene.add(new THREE.Mesh(geometry, material));
     const renderer = new THREE.WebGLRenderer();
     renderer.render(scene, camera);`,
    `import { AmbientLight, Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new AmbientLight(0xffffff, 0), new Mesh(geometry, new MeshStandardMaterial()));
     new WebGLRenderer().render(scene, camera);`,
    `import { AmbientLight, Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     const light = new AmbientLight();
     light.intensity = 0;
     scene.add(light, new Mesh(geometry, new MeshStandardMaterial()));
     new WebGLRenderer().render(scene, camera);`,
  ])("reports PBR materials in a closed rendered scene without lighting", (code) => {
    expect(runRule(threeRequireLightingForPbr, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { AmbientLight, Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new AmbientLight(), new Mesh(geometry, new MeshStandardMaterial()));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene(); scene.environment = environment;
     scene.add(new Mesh(geometry, new MeshStandardMaterial()));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ envMap: environment })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ lightMap: bakedLight })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ emissive: 0xffffff })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(importedModel, new Mesh(geometry, new MeshStandardMaterial()));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     if (shouldShowMesh) scene.add(new Mesh(geometry, new MeshStandardMaterial()));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     const mesh = new Mesh(geometry, new MeshStandardMaterial());
     scene.add(mesh);
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ visible: false })));
     new WebGLRenderer().render(scene, camera);`,
    `import { Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new Mesh(geometry, new MeshStandardMaterial({ transparent: true, opacity: 0 })));
     new WebGLRenderer().render(scene, camera);`,
    `import { AmbientLight, Mesh, MeshStandardMaterial, Scene, WebGLRenderer } from "three";
     const scene = new Scene();
     scene.add(new AmbientLight(...lightArguments), new Mesh(geometry, new MeshStandardMaterial()));
     new WebGLRenderer().render(scene, camera);`,
  ])("keeps lit, self-lit, and open rendered-scene contracts quiet", (code) => {
    expect(runRule(threeRequireLightingForPbr, code).diagnostics).toHaveLength(0);
  });
});
