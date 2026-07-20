// rule: r3f-no-extend-three-namespace
// weakness: framework-gating
// source: RDE pmndrs/react-postprocessing@90d10d59 src/EffectComposer.test.tsx
import { extend } from "@react-three/fiber";
import * as THREE from "three";

extend(THREE);
