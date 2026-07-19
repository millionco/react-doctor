// rule: r3f-require-root-unmount
import { createRoot } from "@react-three/fiber";

export const Scene = ({ canvas }) => {
  const root = createRoot(canvas);
  root.render(<mesh />);
  return null;
};
