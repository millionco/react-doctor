// verdict: fail
// rule: three-prefer-instanced-mesh
// weakness: copy-tracking
// source: adversarial-fuzz
import { Mesh, Scene } from "three";

const scene = new Scene();
[0, 1].map(() => {
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);
  return mesh;
});
