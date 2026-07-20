// rule: r3f-no-extend-three-namespace
// weakness: library-idiom
// source: R3F v9 WebGPU migration guide
import { extend } from "@react-three/fiber";
import * as THREE from "three/webgpu";

extend(THREE as any);

export const Scene = () => <mesh />;
