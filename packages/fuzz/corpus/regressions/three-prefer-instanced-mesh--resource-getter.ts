// verdict: pass
// rule: three-prefer-instanced-mesh
// weakness: getter-identity
// source: adversarial-audit
import { Mesh, Scene } from "three";

const scene = new Scene();
const resources = {
  get geometry() {
    return createGeometry();
  },
  material,
};
scene.add(...[0, 1].map(() => new Mesh(resources.geometry, resources.material)));
