import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuNoJsUniformBranch } from "./r3f-webgpu-no-js-uniform-branch.js";

describe("r3f-webgpu-no-js-uniform-branch", () => {
  it("reports JavaScript branches over WebGPU uniform values", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { useLocalNodes } from "@react-three/fiber/webgpu";
       useLocalNodes(({ uniforms }) => {
         if (uniforms.uMode.value === 0) return { colorNode: red };
         return { colorNode: blue };
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows stable value aliases in both render-pipeline callbacks", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import * as Fiber from "@react-three/fiber/webgpu";
       Fiber.useRenderPipeline(
         (state) => { const mode = state.uniforms.uMode.value; return mode ? { pass } : {}; },
         ({ uniforms }) => { switch (uniforms.quality.value) { case 1: configure(); } },
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports short-circuit branches over WebGPU uniform values", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { useNodes } from "@react-three/fiber/webgpu";
       useNodes(({ uniforms }) => {
         uniforms.enabled.value && configureEnabledGraph();
         uniforms.fallback.value || configureFallbackGraph();
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports a uniform once when a short circuit is an if test", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { useNodes } from "@react-three/fiber/webgpu";
       useNodes(({ uniforms }) => {
         if (uniforms.enabled.value && isSupported) configureGraph();
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows TSL control flow and static JavaScript feature branches", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { useNodes } from "@react-three/fiber/webgpu";
       useNodes(({ uniforms }) => {
         If(uniforms.uMode.equal(0), () => result.assign(red));
         if (qualityPreset === "high") configureExpensiveGraph();
         uniforms.uMode.value = nextMode;
         return { result };
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unrelated hooks and shadowed imports", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { useLocalNodes } from "@react-three/fiber/webgpu";
       const wrapper = (useLocalNodes) => useLocalNodes(({ uniforms }) => uniforms.mode.value ? a : b);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
