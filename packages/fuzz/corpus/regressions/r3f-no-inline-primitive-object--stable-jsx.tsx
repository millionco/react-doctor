// rule: r3f-no-inline-primitive-object
import "@react-three/fiber";
import { useMemo } from "react";

export const Scene = ({ scene }) => useMemo(() => <primitive object={scene.clone()} />, [scene]);
