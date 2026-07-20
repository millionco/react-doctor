// rule: r3f-no-extend-three-namespace
import { extend } from "@react-three/fiber";

const sharedCatalogue = { Mesh: CustomMesh };

extend({ ...sharedCatalogue, Line: CustomLine });
