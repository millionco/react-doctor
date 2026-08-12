import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireLightingForPbr } from "./r3f-require-lighting-for-pbr.js";

describe("r3f-require-lighting-for-pbr", () => {
  it.each([
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas as FiberCanvas } from "@react-three/fiber";
     const Scene = () => <FiberCanvas><group><mesh><sphereGeometry /><meshPhysicalMaterial /></mesh></group></FiberCanvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><ambientLight intensity={0} /><mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial envMap={null} lightMap={undefined} emissive={null} /></mesh></Canvas>;`,
  ])("reports PBR materials in a closed unlit Canvas", (code) => {
    expect(runRule(r3fRequireLightingForPbr, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><ambientLight /><mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber"; import { Environment } from "@react-three/drei";
     const Scene = () => <Canvas><Environment files="studio.hdr" /><mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><boxGeometry /><meshStandardMaterial envMap={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><boxGeometry /><meshStandardMaterial lightMap={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial emissive="white" /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Lights = () => <ambientLight />;
     const Scene = () => <Canvas><Lights /><mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ children }) => <Canvas>{children}<mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><meshStandardMaterial /></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh material={material}><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh visible={false}><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><boxGeometry /><meshStandardMaterial transparent opacity={0} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ visible }) => <Canvas><mesh visible={visible}><boxGeometry /><meshStandardMaterial /></mesh></Canvas>;`,
  ])("keeps lit, self-lit, and open Canvas contracts quiet", (code) => {
    expect(runRule(r3fRequireLightingForPbr, code).diagnostics).toHaveLength(0);
  });
});
