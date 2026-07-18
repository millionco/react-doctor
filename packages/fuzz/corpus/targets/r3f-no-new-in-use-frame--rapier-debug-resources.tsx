// rule: r3f-no-new-in-use-frame
// source: react-bench-5 fix-react-rdh-pmndrs-react-three-rapier-debug
import { useFrame } from "@react-three/fiber";
import { BufferAttribute, BufferGeometry } from "three";

export const Debug = ({ mesh, world }) => {
  useFrame(() => {
    const buffers = world.debugRender();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(buffers.vertices, 3));
    geometry.setAttribute("color", new BufferAttribute(buffers.colors, 4));
    mesh.geometry = geometry;
  });
  return null;
};
