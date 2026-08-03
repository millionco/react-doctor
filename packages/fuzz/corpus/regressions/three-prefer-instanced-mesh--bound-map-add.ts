// verdict: fail
// rule: three-prefer-instanced-mesh
// weakness: copy-tracking
// source: adversarial-fuzz
import { Mesh, Scene } from "three";

const scene = new Scene();
const meshes = [0, 1].map(() => new Mesh(geometry, material));
scene.add(...meshes);
