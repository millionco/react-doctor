import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireDynamicBufferUsage } from "./r3f-require-dynamic-buffer-usage.js";

describe("r3f-require-dynamic-buffer-usage", () => {
  it.each([
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Points = () => { const attributeRef = useRef(); useFrame(() => { attributeRef.current.needsUpdate = true; }); return <bufferAttribute ref={attributeRef} args={[new Float32Array(9), 3]} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { StaticDrawUsage } from "three"; import { useRef } from "react"; export const Points = () => { const attributeRef = useRef(); useFrame(() => { attributeRef.current.needsUpdate = true; }); return <instancedBufferAttribute ref={attributeRef} usage={StaticDrawUsage} args={[new Float32Array(9), 3]} />; };`,
  ])("reports per-frame uploads without dynamic usage", (code) => {
    expect(runRule(r3fRequireDynamicBufferUsage, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { useFrame } from "@react-three/fiber"; import { DynamicDrawUsage } from "three"; import { useRef } from "react"; export const Points = () => { const attributeRef = useRef(); useFrame(() => { attributeRef.current.needsUpdate = true; }); return <bufferAttribute ref={attributeRef} usage={DynamicDrawUsage} args={[new Float32Array(9), 3]} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Points = () => { const attributeRef = useRef(); useFrame(() => { if (changed) attributeRef.current.needsUpdate = true; }); return <bufferAttribute ref={attributeRef} args={[new Float32Array(9), 3]} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Mesh = () => { const meshRef = useRef(); useFrame(() => { meshRef.current.needsUpdate = true; }); return <mesh ref={meshRef} />; };`,
  ])("keeps dynamic, guarded, and non-buffer refs quiet", (code) => {
    expect(runRule(r3fRequireDynamicBufferUsage, code).diagnostics).toHaveLength(0);
  });
});
