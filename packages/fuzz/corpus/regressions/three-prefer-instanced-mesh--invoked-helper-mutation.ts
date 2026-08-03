// verdict: pass
// rule: three-prefer-instanced-mesh
// weakness: control-flow
// source: bugbot-review
import { Mesh, Object3D, Scene } from "three";

const scene = new Scene();
scene.add(
  ...[0, 1].map(() => {
    const mesh = new Mesh(geometry, material);
    const addChild = () => mesh.add(new Object3D());
    addChild();
    return mesh;
  }),
);
