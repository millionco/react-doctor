import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireEnvironmentForMetal } from "./r3f-require-environment-for-metal.js";

describe("r3f-require-environment-for-metal", () => {
  it.each([
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial metalness={0.9} /></mesh><directionalLight /></Canvas>;`,
    `import { Canvas as FiberCanvas } from "@react-three/fiber";
     const METALNESS = 3 / 4;
     const Scene = () => <FiberCanvas><mesh><sphereGeometry /><meshPhysicalMaterial metalness={METALNESS} /></mesh></FiberCanvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial metalness={1} envMap={null} /></mesh></Canvas>;`,
  ])("reports strongly metallic materials in a closed Canvas without an environment", (code) => {
    expect(runRule(r3fRequireEnvironmentForMetal, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Canvas } from "@react-three/fiber"; import { Environment } from "@react-three/drei";
     const Scene = () => <Canvas><Environment preset="studio" /><mesh><boxGeometry /><meshStandardMaterial metalness={1} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ environment }) => <Canvas scene={{ environment }}><mesh><boxGeometry /><meshStandardMaterial metalness={1} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><boxGeometry /><meshStandardMaterial metalness={1} envMap={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial metalness={0.5} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ metalness }) => <Canvas><mesh><boxGeometry /><meshStandardMaterial metalness={metalness} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Model = () => <mesh><boxGeometry /><meshStandardMaterial metalness={1} /></mesh>;
     const Scene = () => <Canvas><Model /></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ props }) => <Canvas><mesh><boxGeometry /><meshStandardMaterial metalness={1} {...props} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><meshStandardMaterial metalness={1} /></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh material={material}><boxGeometry /><meshStandardMaterial metalness={1} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><group visible={false}><mesh><boxGeometry /><meshStandardMaterial metalness={1} /></mesh></group></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial metalness={1} transparent opacity={0} /></mesh></Canvas>;`,
  ])("keeps environmental, weak, and open Canvas contracts quiet", (code) => {
    expect(runRule(r3fRequireEnvironmentForMetal, code).diagnostics).toHaveLength(0);
  });
});
