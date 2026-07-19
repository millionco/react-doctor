import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuNoLegacyEffectComposer } from "./r3f-webgpu-no-legacy-effect-composer.js";

describe("r3f-webgpu-no-legacy-effect-composer", () => {
  it("requires the renderer-neutral R3F WebGPU release", () => {
    expect(r3fWebgpuNoLegacyEffectComposer.requires).toEqual(["r3f:10"]);
  });

  it("reports imported EffectComposer below WebGPU Canvas", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `import { Canvas } from "@react-three/fiber/webgpu";
       import { EffectComposer as Composer } from "@react-three/postprocessing";
       const scene = <Canvas><Composer><Bloom /></Composer></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves namespace and CommonJS composer provenance", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `const Fiber = require("@react-three/fiber/webgpu");
       const Post = require("@react-three/postprocessing");
       const first = <Fiber.Canvas><Post.EffectComposer /></Fiber.Canvas>;
       import * as Effects from "@react-three/postprocessing";
       const second = <Fiber.Canvas><Effects.EffectComposer /></Fiber.Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows the composer under legacy Canvas and node pipelines under WebGPU", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `import { Canvas as WebgpuCanvas } from "@react-three/fiber/webgpu";
       import { Canvas as LegacyCanvas } from "@react-three/fiber/legacy";
       import { EffectComposer } from "@react-three/postprocessing";
       import { RenderPipeline } from "@react-three/fiber/webgpu";
       const legacy = <LegacyCanvas><EffectComposer /></LegacyCanvas>;
       const modern = <WebgpuCanvas><RenderPipeline /></WebgpuCanvas>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unrelated and imported opaque components", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `import { Canvas } from "@react-three/fiber/webgpu";
       import { EffectComposer } from "other-effects";
       import { SceneEffects } from "./effects";
       const scene = <Canvas><EffectComposer /><SceneEffects /></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
