// rule: r3f-no-unstable-args
import "@react-three/fiber";
import { useMemo } from "react";

export const Scene = () => useMemo(() => <mesh args={[{ width: 1 }]} />, []);
