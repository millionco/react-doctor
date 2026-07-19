import { useThree } from "@react-three/fiber";

export const ManualResize = () => {
  const renderer = useThree((state) => state.gl);
  window.addEventListener("resize", () => renderer.setSize(1, 1));
  return null;
};
