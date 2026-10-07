import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoCompileInUseFrame } from "./r3f-no-compile-in-use-frame.js";

describe("r3f-no-compile-in-use-frame", () => {
  it("reports state renderer precompilation inside useFrame", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      export const Scene = () => {
        useFrame(({ gl, scene, camera }) => gl.compile(scene, camera));
        useFrame((state) => state.renderer.compileAsync(state.scene, state.camera));
        return null;
      };
    `;
    expect(runRule(r3fNoCompileInUseFrame, code).diagnostics).toHaveLength(2);
  });

  it("allows external, nonframe, and shadowed callbacks", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      renderer.compile(scene, camera);
      export const Scene = () => {
        useFrame(() => compiler.compile(scene));
        const nested = (useFrame) => useFrame(({ gl }) => gl.compile(scene, camera));
        return null;
      };
    `;
    expect(runRule(r3fNoCompileInUseFrame, code).diagnostics).toHaveLength(0);
  });
});
