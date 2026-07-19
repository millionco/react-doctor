// rule: r3f-no-manual-canvas-resize
// weakness: provenance
// source: adversarial integration review
import { useThree } from "@react-three/fiber";

export const Scene = ({ ResizeObserver }) => {
  const renderer = useThree((state) => state.gl);
  new ResizeObserver(() => renderer.setSize(1, 1));
  return null;
};
