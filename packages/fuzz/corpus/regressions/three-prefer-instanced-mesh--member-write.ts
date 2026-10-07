// verdict: pass
// rule: three-prefer-instanced-mesh
// weakness: copy-tracking
// source: adversarial-audit
import { Mesh, Scene } from "three";

const scene = new Scene();
const resources = { geometry: firstGeometry, material };
scene.add(
  ...[0, 1].map((index) => {
    resources.geometry = createGeometry(index);
    return new Mesh(resources.geometry, resources.material);
  }),
);
