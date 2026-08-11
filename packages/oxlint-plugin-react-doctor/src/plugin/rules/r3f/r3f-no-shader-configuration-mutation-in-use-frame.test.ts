import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoShaderConfigurationMutationInUseFrame } from "./r3f-no-shader-configuration-mutation-in-use-frame.js";

describe("r3f-no-shader-configuration-mutation-in-use-frame", () => {
  it.each([
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Scene = () => { const materialRef = useRef(); useFrame(() => { materialRef.current.fragmentShader = buildShader(); }); return <shaderMaterial ref={materialRef} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Scene = () => { const materialRef = useRef(); useFrame(() => { materialRef.current.defines.MODE = mode; }); return <rawShaderMaterial ref={materialRef} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Scene = () => { const materialRef = useRef(); useFrame(() => { materialRef.current.uniforms = makeUniforms(); }); return <shaderMaterial ref={materialRef} />; };`,
  ])("reports unconditional shader configuration writes in useFrame", (code) => {
    expect(runRule(r3fNoShaderConfigurationMutationInUseFrame, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Scene = () => { const materialRef = useRef(); useFrame(() => { materialRef.current.uniforms.time.value += 1; }); return <shaderMaterial ref={materialRef} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Scene = () => { const materialRef = useRef(); useFrame(() => { if (changed) materialRef.current.defines.MODE = mode; }); return <shaderMaterial ref={materialRef} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Scene = () => { const materialRef = useRef(); useFrame(() => { materialRef.current.fragmentShader = source; }); return <meshStandardMaterial ref={materialRef} />; };`,
  ])("keeps uniform-value, guarded, and non-shader-material writes quiet", (code) => {
    expect(runRule(r3fNoShaderConfigurationMutationInUseFrame, code).diagnostics).toHaveLength(0);
  });
});
