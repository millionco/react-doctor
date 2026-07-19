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

  it("supports both released-alpha usePostProcessing callbacks", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { usePostProcessing } from "@react-three/fiber/webgpu";
       usePostProcessing(
         ({ uniforms }) => uniforms.enabled.value ? enabled : disabled,
         ({ uniforms }) => { if (uniforms.quality.value > 1) configure(); },
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports branches over immutable uniforms created outside the graph callback", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { uniform as makeUniform } from "three/tsl";
       import * as WebGPU from "three/webgpu";
       import { useNodes } from "@react-three/fiber/webgpu";
       const mode = makeUniform(0);
       const quality = WebGPU.uniform(1);
       useNodes(() => {
         if (mode.value) configureMode();
         return quality.value > 1 ? high : low;
       });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("tracks exact immutable aliases of the TSL uniform factory", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { uniform } from "three/tsl";
       import { useNodes } from "@react-three/fiber/webgpu";
       const createUniform = uniform;
       const mode = createUniform(0);
       useNodes(() => mode.value ? enabled : disabled);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores mutable, shadowed, and non-uniform values outside the graph callback", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { uniform } from "three/tsl";
       import { useNodes } from "@react-three/fiber/webgpu";
       let mutableMode = uniform(0);
       mutableMode = replacement;
       const plainMode = { value: 1 };
       const buildNodes = (uniform) => {
         const shadowedMode = uniform(0);
         useNodes(() => shadowedMode.value ? enabled : disabled);
       };
       useNodes(() => mutableMode.value ? enabled : disabled);
       useNodes(() => plainMode.value ? enabled : disabled);`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("resolves graph callbacks wrapped by React useCallback", () => {
    const result = runRule(
      r3fWebgpuNoJsUniformBranch,
      `import { useNodes } from "@react-three/fiber/webgpu";
       import { useCallback } from "react";
       const buildNodes = useCallback(({ uniforms }) => uniforms.enabled.value ? enabled : disabled, []);
       useNodes(buildNodes);`,
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
