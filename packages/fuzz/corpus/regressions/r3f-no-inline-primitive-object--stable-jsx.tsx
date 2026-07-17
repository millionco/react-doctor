// rule: r3f-no-inline-primitive-object
import { useMemo } from "react";

export const Scene = ({ scene }) => useMemo(() => <primitive object={scene.clone()} />, [scene]);
