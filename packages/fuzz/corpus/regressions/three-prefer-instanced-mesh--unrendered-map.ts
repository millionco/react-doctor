// verdict: pass
// rule: three-prefer-instanced-mesh
// weakness: render-consumption
// source: adversarial-audit
import { Mesh } from "three";

const collisionSamples = [0, 1].map(() => new Mesh(geometry, material));
collisionSamples.forEach((mesh) => mesh.geometry.computeBoundingBox());
