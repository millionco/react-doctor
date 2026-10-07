import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireDataTextureUpdate } from "./r3f-require-data-texture-update.js";

describe("r3f-require-data-texture-update", () => {
  it.each([
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Texture = () => { const textureRef = useRef(); useFrame(() => { textureRef.current.image.data[0] = 255; }); return <dataTexture ref={textureRef} args={[new Uint8Array(16), 2, 2]} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Texture = () => { const textureRef = useRef(); useFrame(() => { textureRef.current.image.data.fill(0); }); return <data3DTexture ref={textureRef} args={[new Uint8Array(32), 2, 2, 2]} />; };`,
  ])("reports R3F data-texture changes without an upload flag", (code) => {
    expect(runRule(r3fRequireDataTextureUpdate, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Texture = () => { const textureRef = useRef(); useFrame(() => { textureRef.current.image.data[0] = 255; textureRef.current.needsUpdate = true; }); return <dataTexture ref={textureRef} args={[new Uint8Array(16), 2, 2]} />; };`,
    `import { useFrame } from "@react-three/fiber"; import { useRef } from "react"; export const Mesh = () => { const meshRef = useRef(); useFrame(() => { meshRef.current.image.data[0] = 255; }); return <mesh ref={meshRef} />; };`,
  ])("keeps covered and non-texture refs quiet", (code) => {
    expect(runRule(r3fRequireDataTextureUpdate, code).diagnostics).toHaveLength(0);
  });
});
