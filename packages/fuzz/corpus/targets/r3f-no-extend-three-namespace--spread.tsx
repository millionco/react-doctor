// rule: r3f-no-extend-three-namespace
import { extend } from "@react-three/fiber";
import * as THREE from "three";

const catalogue = { Mesh: CustomMesh, ...THREE };

extend(catalogue);
