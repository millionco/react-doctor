import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoMutateUniformPropSourceInUseFrame } from "./r3f-no-mutate-uniform-prop-source-in-use-frame.js";

describe("r3f-no-mutate-uniform-prop-source-in-use-frame", () => {
  it.each([
    `import { useFrame } from "@react-three/fiber"; import { useMemo } from "react"; const Scene = () => { const uniforms = useMemo(() => ({ time: { value: 0 } }), []); useFrame(({ clock }) => { uniforms.time.value = clock.elapsedTime; }); return <shaderMaterial uniforms={uniforms} />; };`,
    `import * as Fiber from "@react-three/fiber"; const Scene = () => { const source = { color: { value: [1, 0, 0] } }; const alias = source; Fiber.useFrame(() => { alias.color.value[0]++; }); return <rawShaderMaterial uniforms={source} />; };`,
    `const { useFrame } = require("@react-three/fiber"); const Scene = () => { const uniforms = { time: { value: 0 } }; const tick = () => { uniforms.time.value += 1; }; useFrame(() => tick()); return <shaderMaterial uniforms={uniforms} />; };`,
  ])("reports writes to a uniforms prop source from useFrame", (code) => {
    expect(runRule(r3fNoMutateUniformPropSourceInUseFrame, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; const Scene = () => { const material = useRef(); const uniforms = { time: { value: 0 } }; useFrame(({ clock }) => { material.current.uniforms.time.value = clock.elapsedTime; }); return <shaderMaterial ref={material} uniforms={uniforms} />; };`,
    `import { useFrame } from "@react-three/fiber"; const Scene = () => { const uniforms = { time: { value: 0 } }; useFrame(() => { read(uniforms.time.value); }); return <shaderMaterial uniforms={uniforms} />; };`,
    `import { useFrame } from "@react-three/fiber"; const Scene = () => { const uniforms = { time: { value: 0 } }; useFrame(() => { uniforms.time.value = 1; }); return <meshBasicMaterial />; };`,
    `import { useFrame } from "other"; const Scene = () => { const uniforms = { time: { value: 0 } }; useFrame(() => { uniforms.time.value = 1; }); return <shaderMaterial uniforms={uniforms} />; };`,
    `import { useFrame } from "@react-three/fiber"; const Scene = () => { const uniforms = { time: { value: 0 } }; useFrame(() => { uniforms.time.value = 1; }); return <shaderMaterial uniforms={uniforms} {...props} />; };`,
  ])("keeps material-ref updates, reads, unrelated JSX, and unresolved props quiet", (code) => {
    expect(runRule(r3fNoMutateUniformPropSourceInUseFrame, code).diagnostics).toHaveLength(0);
  });
});
