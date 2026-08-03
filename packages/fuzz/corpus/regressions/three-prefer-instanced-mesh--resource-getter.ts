// verdict: pass
// rule: three-prefer-instanced-mesh
// weakness: getter-identity
// source: adversarial-audit
import { Mesh, Scene } from "three";

const scene = new Scene();
const meshResources = {
  get geometry() {
    return createGeometry();
  },
};
const resources = { mesh: meshResources, material };
scene.add(...[0, 1].map(() => new Mesh(resources.mesh.geometry, resources.material)));
