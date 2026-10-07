// verdict: pass
// rule: three-prefer-instanced-mesh
// weakness: alias-guard
// source: adversarial-fuzz
import { Mesh, Scene } from "three";

const scene = new Scene();
const resources = { geometry: firstGeometry, material };
scene.add(
  ...[0, 1].map((index) => {
    const mutableResources = resources;
    mutableResources.geometry = createGeometry(index);
    return new Mesh(resources.geometry, resources.material);
  }),
);
