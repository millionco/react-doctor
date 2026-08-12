// rule: three-require-lit-material-normals
// verdict: pass
// weakness: control-flow
// source: Cursor Bugbot review on millionco/react-doctor#1633

import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";

const geometry = new BufferGeometry();
geometry.setAttribute("position", new BufferAttribute(positions, 3));
const mesh = new Mesh(geometry, new MeshStandardMaterial({ normalMap: new Texture() }));

for (const item of items) mesh.visible = false;
