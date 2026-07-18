// rule: r3f-no-new-in-use-frame
// weakness: control-flow
// source: react-bench task fix-react-rdh-pmndrs-react-three-rapier-debug
import { useFrame } from "@react-three/fiber";
import { BufferAttribute } from "three";

const updateAttribute = (geometry, buffers) => {
  const attribute = geometry.getAttribute("position");
  if (attribute.array.length !== buffers.length) {
    geometry.setAttribute("position", new BufferAttribute(buffers, 3));
  }
};

export const Debug = ({ geometry, world }) => {
  useFrame(() => {
    updateAttribute(geometry, world.debugRender().vertices);
  });
  return null;
};
