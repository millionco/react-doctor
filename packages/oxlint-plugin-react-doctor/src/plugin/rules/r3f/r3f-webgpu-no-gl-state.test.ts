import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuNoGlState } from "./r3f-webgpu-no-gl-state.js";

describe("r3f-webgpu-no-gl-state", () => {
  it("reports gl selectors and destructuring from the WebGPU entry point", () => {
    const result = runRule(
      r3fWebgpuNoGlState,
      `import { useThree } from "@react-three/fiber/webgpu";
       const selected = useThree((state) => state.gl);
       const { gl } = useThree();
       const state = useThree();
       const direct = state["gl"];`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports gl reads from WebGPU frame state", () => {
    const result = runRule(
      r3fWebgpuNoGlState,
      `import * as Fiber from "@react-three/fiber/webgpu";
       Fiber.useFrame(({ gl }) => gl.render(scene, camera));
       Fiber.useFrame((state) => state.gl.render(scene, camera));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports callback-local state destructuring", () => {
    const result = runRule(
      r3fWebgpuNoGlState,
      `import { useThree, useFrame } from "@react-three/fiber/webgpu";
       useThree((state) => { const { gl } = state; return gl; });
       useFrame((state) => { const { ["gl"]: renderer } = state; renderer.render(scene, camera); });
       useThree((state) => { const { gl = fallbackRenderer } = state; return gl; });
       useFrame((state) => { const { ["gl"]: renderer = fallbackRenderer } = state; renderer.render(scene, camera); });`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("resolves WebGPU callbacks wrapped by CommonJS React useCallback", () => {
    const result = runRule(
      r3fWebgpuNoGlState,
      `const { useFrame } = require("@react-three/fiber/webgpu");
       const { useCallback } = require("react");
       const update = useCallback((state) => state.gl.render(scene, camera), []);
       useFrame(update);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows renderer and version-ambiguous gl state", () => {
    const result = runRule(
      r3fWebgpuNoGlState,
      `import { useThree as useWebgpuThree } from "@react-three/fiber/webgpu";
       import { useThree } from "@react-three/fiber";
       import { useThree as useLegacyThree } from "@react-three/fiber/legacy";
       useWebgpuThree((state) => state.renderer);
       useThree((state) => state.gl);
       useLegacyThree((state) => state.gl);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores shadowed and unrelated gl values", () => {
    const result = runRule(
      r3fWebgpuNoGlState,
      `import { useThree } from "@react-three/fiber/webgpu";
       const local = (useThree) => useThree((state) => state.gl);
       const value = source.gl;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
