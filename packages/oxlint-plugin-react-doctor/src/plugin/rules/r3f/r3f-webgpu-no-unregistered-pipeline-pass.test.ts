import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuNoUnregisteredPipelinePass } from "./r3f-webgpu-no-unregistered-pipeline-pass.js";

describe("r3f-webgpu-no-unregistered-pipeline-pass", () => {
  it("reports direct writes to the pass registry", () => {
    const result = runRule(
      r3fWebgpuNoUnregisteredPipelinePass,
      `import { useRenderPipeline } from "@react-three/fiber/webgpu";
       useRenderPipeline(({ passes, scene, camera }) => {
         passes.depthPass = pass(scene, camera);
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports computed and state-member writes in both callbacks", () => {
    const result = runRule(
      r3fWebgpuNoUnregisteredPipelinePass,
      `import * as Fiber from "@react-three/fiber/webgpu";
       Fiber.useRenderPipeline(
         (state) => { state.passes["colorPass"] = colorPass; },
         ({ passes }) => { passes.normalPass = normalPass; },
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports the released-alpha usePostProcessing name", () => {
    const result = runRule(
      r3fWebgpuNoUnregisteredPipelinePass,
      `import { usePostProcessing } from "@react-three/fiber/webgpu";
       usePostProcessing(
         ({ passes }) => { passes.color = colorPass; },
         ({ passes }) => { passes.depth = depthPass; },
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves pipeline callbacks wrapped by TypeScript import-equals React useCallback", () => {
    const result = runRule(
      r3fWebgpuNoUnregisteredPipelinePass,
      `import Fiber = require("@react-three/fiber/webgpu");
       import React = require("react");
       const buildPipeline = React.useCallback(({ passes }) => { passes.custom = customPass; }, []);
       Fiber.useRenderPipeline(buildPipeline);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows returned passes and mutation of registered pass objects", () => {
    const result = runRule(
      r3fWebgpuNoUnregisteredPipelinePass,
      `import { useRenderPipeline } from "@react-three/fiber/webgpu";
       useRenderPipeline(({ passes, scene, camera }) => {
         passes.scenePass.setMRT(mrt({ output, velocity }));
         passes.scenePass.outputNode = output;
         const customPass = pass(scene, camera);
         return { customPass };
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unrelated registries and shadowed hooks", () => {
    const result = runRule(
      r3fWebgpuNoUnregisteredPipelinePass,
      `import { useRenderPipeline } from "@react-three/fiber/webgpu";
       const wrapper = (useRenderPipeline) => useRenderPipeline(({ passes }) => { passes.custom = value; });
       other.passes.custom = value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
