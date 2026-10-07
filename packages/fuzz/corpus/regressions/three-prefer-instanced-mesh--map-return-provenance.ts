// verdict: pass
// rule: three-prefer-instanced-mesh
// weakness: return-provenance
// source: adversarial-audit
import { Group, Mesh, Scene } from "three";

const scene = new Scene();
scene.add(
  ...[0, 1].map(() => {
    const collisionSample = new Mesh(geometry, material);
    collisionSample.geometry.computeBoundingBox();
    return new Group();
  }),
);
scene.add(...[0, 1].map(() => new Mesh(geometry, material).add(new Group())));
