import { useThree } from "@react-three/fiber";

export const Scene = () => {
  const renderer = useThree((state) => state.gl);
  new ResizeObserver(() => renderer.setSize(window.innerWidth, window.innerHeight));
  return null;
};
