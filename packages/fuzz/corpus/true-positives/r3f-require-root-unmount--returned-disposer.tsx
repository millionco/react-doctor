// rule: r3f-require-root-unmount
// weakness: effect-ownership
// source: lifecycle audit
import { createRoot } from "@react-three/fiber";

export const useRootDisposer = (canvas) => {
  const root = createRoot(canvas);
  root.configure({});
  return () => root.unmount();
};
