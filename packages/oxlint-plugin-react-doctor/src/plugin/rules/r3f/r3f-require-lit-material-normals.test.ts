import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireLitMaterialNormals } from "./r3f-require-lit-material-normals.js";

describe("r3f-require-lit-material-normals", () => {
  it.each([
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial normalMap={texture} /></mesh></Canvas>;`,
    `import "@react-three/fiber";
     const attachment = "attributes-position";
     const Scene = ({ texture }) => <mesh><bufferGeometry><float32BufferAttribute attach={attachment} args={[positions, 3]} /></bufferGeometry><meshPhongMaterial normalMap={texture} /></mesh>;`,
  ])("reports closed declarative geometry without normals", (code) => {
    expect(runRule(r3fRequireLitMaterialNormals, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /><bufferAttribute attach="attributes-normal" args={[normals, 3]} /></bufferGeometry><meshPhysicalMaterial normalMap={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><bufferGeometry ref={geometryRef}><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><bufferGeometry onUpdate={(geometry) => geometry.computeVertexNormals()}><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><bufferGeometry><bufferAttribute attach={attributeName} args={[positions, 3]} /></bufferGeometry><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} />{attributes}</bufferGeometry><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshBasicMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh geometry={geometry}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><group visible={false}><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial normalMap={texture} /></mesh></group></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial normalMap={texture} transparent opacity={0} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture, visible }) => <Canvas><mesh visible={visible}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial normalMap={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial attach="customDepthMaterial" normalMap={texture} /></mesh></Canvas>;`,
    `const Scene = () => <mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial /></mesh>;`,
  ])("keeps valid, externally mutable, and unrelated geometry quiet", (code) => {
    expect(runRule(r3fRequireLitMaterialNormals, code).diagnostics).toHaveLength(0);
  });
});
