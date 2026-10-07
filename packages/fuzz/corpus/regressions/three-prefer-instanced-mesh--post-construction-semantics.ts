// verdict: pass
// rule: three-prefer-instanced-mesh
// weakness: library-idiom
// source: adversarial-fuzz
import { Mesh, Object3D, Scene } from "three";

const scene = new Scene();
scene.add(
  ...[0, 1].map((index) => {
    const mesh = new Mesh(geometry, material);
    mesh.geometry = createGeometry(index);
    return mesh;
  }),
);
scene.add(
  ...[0, 1].map(() => {
    const mesh = new Mesh(geometry, material);
    mesh.add(new Object3D());
    return mesh;
  }),
);
