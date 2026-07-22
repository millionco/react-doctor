import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoObjectConstructionInRender } from "./three-no-object-construction-in-render.js";

describe("three-no-object-construction-in-render", () => {
  it.each([
    `import { Scene } from "three"; const View = () => { const scene = new Scene(); return <canvas />; };`,
    `import * as THREE from "three"; function useCamera() { return new THREE.PerspectiveCamera(); }`,
    `import { Scene } from "three"; import { useRef } from "react"; const View = () => { const scene = useRef(new Scene()); return <canvas />; };`,
    `import { Scene } from "three"; import { useState } from "react"; const View = () => { const [scene] = useState(new Scene()); return <canvas />; };`,
    `import { Vector3 } from "three"; import { useFrame } from "@react-three/fiber"; function View() { return <CameraRig />; } function CameraRig({ vector = new Vector3() }) { return useFrame(() => vector.set(0, 0, 0)); }`,
  ])("flags Three.js construction during React render", (code) => {
    expect(runRule(threeNoObjectConstructionInRender, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Scene } from "three"; const scene = new Scene(); const View = () => <canvas />;`,
    `import { Scene } from "three"; import { useMemo } from "react"; const View = () => { const scene = useMemo(() => new Scene(), []); return <canvas />; };`,
    `import { Scene } from "three"; import { useState } from "react"; const View = () => { const [scene] = useState(() => new Scene()); return <canvas />; };`,
    `import { Scene } from "three"; const View = () => <button onClick={() => new Scene()} />;`,
    `import { Vector3 } from "three"; export const THROW_ALPHA = () => new Vector3();`,
    `import { Mesh } from "three"; export function CSGArray2R3fComponent() { return [new Mesh()]; }`,
    `import { BufferGeometry } from "three"; const View = ({ points }) => <primitive object={TriangleGeometry({ points })} />; export function TriangleGeometry({ points }) { const geometry = new BufferGeometry(); return geometry; }`,
    `import { Scene } from "other"; const View = () => { const scene = new Scene(); return <canvas />; };`,
  ])("allows stable, deferred, or unrelated construction", (code) => {
    expect(runRule(threeNoObjectConstructionInRender, code).diagnostics).toHaveLength(0);
  });
});
