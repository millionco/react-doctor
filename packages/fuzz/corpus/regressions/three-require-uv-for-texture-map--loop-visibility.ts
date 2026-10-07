// rule: three-require-uv-for-texture-map
// verdict: pass
// weakness: control-flow
// source: Cursor Bugbot review on millionco/react-doctor#1633

import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Texture } from "three";

const geometry = new BufferGeometry();
geometry.setAttribute("position", new BufferAttribute(positions, 3));
const mesh = new Mesh(geometry, new MeshStandardMaterial({ map: new Texture() }));

while (shouldHide()) mesh.visible = false;
