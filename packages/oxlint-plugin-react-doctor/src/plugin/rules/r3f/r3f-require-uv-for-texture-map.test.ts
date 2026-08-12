import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireUvForTextureMap } from "./r3f-require-uv-for-texture-map.js";

describe("r3f-require-uv-for-texture-map", () => {
  it.each([
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial map={texture} /></mesh></Canvas>;`,
    `import "@react-three/fiber";
     const Scene = ({ texture }) => <mesh><bufferGeometry><float32BufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshPhongMaterial normalMap={texture} /></mesh>;`,
    `import "@react-three/fiber";
     const Scene = ({ texture }) => <mesh><bufferGeometry><float32BufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshPhysicalMaterial anisotropyMap={texture} /></mesh>;`,
  ])("reports closed mapped geometry without UVs", (code) => {
    expect(runRule(r3fRequireUvForTextureMap, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /><bufferAttribute attach="attributes-uv" args={[uvs, 2]} /></bufferGeometry><meshStandardMaterial map={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /><bufferAttribute attach="attributes-uv3" args={[uvs, 2]} /></bufferGeometry><meshStandardMaterial aoMap={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = () => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial map={null} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture, materialProps }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial map={texture} {...materialProps} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry ref={geometryRef}><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial map={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><shaderMaterial uniforms={{ map: { value: texture } }} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshBasicMaterial normalMap={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshToonMaterial gradientMap={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><group visible={false}><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial map={texture} /></mesh></group></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial map={texture} transparent opacity={0} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture, visible }) => <Canvas><mesh visible={visible}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial map={texture} /></mesh></Canvas>;`,
    `import { Canvas } from "@react-three/fiber";
     const Scene = ({ texture }) => <Canvas><mesh><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><meshStandardMaterial attach="customDepthMaterial" map={texture} /></mesh></Canvas>;`,
  ])("keeps valid and unresolved mapped geometry quiet", (code) => {
    expect(runRule(r3fRequireUvForTextureMap, code).diagnostics).toHaveLength(0);
  });
});
