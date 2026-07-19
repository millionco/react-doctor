import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuNoLegacyEffectComposer } from "./r3f-webgpu-no-legacy-effect-composer.js";

describe("r3f-webgpu-no-legacy-effect-composer", () => {
  it("runs for stable-v9 Canvas WebGPU factories", () => {
    expect(r3fWebgpuNoLegacyEffectComposer.requires).toBeUndefined();
  });

  it("reports under a stable Canvas with a proven async WebGPURenderer factory", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `import { Canvas } from "@react-three/fiber";
       import { WebGPURenderer } from "three/webgpu";
       import { EffectComposer } from "@react-three/postprocessing";
       const createRenderer = async (props) => {
         const renderer = new WebGPURenderer(props);
         await renderer.init();
         return renderer;
       };
       const scene = <Canvas gl={createRenderer}><EffectComposer /></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows a same-file local composer component under proven WebGPU ancestry", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `import { memo } from "react";
       import { Canvas } from "@react-three/fiber";
       import { WebGPURenderer } from "three/webgpu";
       import { EffectComposer } from "@react-three/postprocessing";
       const SceneEffects = memo(() => <EffectComposer />);
       const scene = <Canvas gl={async () => new WebGPURenderer()}><SceneEffects /></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows two-hop and three-hop immutable local component ancestry", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `import { Canvas } from "@react-three/fiber/webgpu";
       import { EffectComposer } from "@react-three/postprocessing";
       const TwoHopEffects = () => <EffectComposer />;
       const TwoHopScene = () => <TwoHopEffects />;
       const ThreeHopEffects = () => <EffectComposer />;
       const ThreeHopMiddle = () => <ThreeHopEffects />;
       const ThreeHopScene = () => <ThreeHopMiddle />;
       const first = <Canvas><TwoHopScene /></Canvas>;
       const second = <Canvas><ThreeHopScene /></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
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

  it("rejects cyclic, dynamic, imported, and legacy-boundary ancestry proofs", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `import { Canvas as WebgpuCanvas } from "@react-three/fiber/webgpu";
       import { Canvas as LegacyCanvas } from "@react-three/fiber/legacy";
       import { EffectComposer } from "@react-three/postprocessing";
       import { ImportedScene } from "./scene";
       const CyclicEffects = () => <><CyclicScene /><EffectComposer /></>;
       const CyclicScene = () => <CyclicEffects />;
       const DynamicEffects = () => <EffectComposer />;
       const SafeEffects = () => null;
       const SelectedEffects = condition ? DynamicEffects : SafeEffects;
       let MutableEffects = () => <EffectComposer />;
       const ImportedEffects = () => <EffectComposer />;
       const BoundedEffects = () => <EffectComposer />;
       const LegacyBoundary = () => <LegacyCanvas><BoundedEffects /></LegacyCanvas>;
       const dynamic = <WebgpuCanvas><SelectedEffects /></WebgpuCanvas>;
       const mutable = <WebgpuCanvas><MutableEffects /></WebgpuCanvas>;
       const imported = <WebgpuCanvas><ImportedScene content={ImportedEffects} /></WebgpuCanvas>;
       const bounded = <WebgpuCanvas><LegacyBoundary /></WebgpuCanvas>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores stable Canvas factories without proven WebGPU provenance", () => {
    const result = runRule(
      r3fWebgpuNoLegacyEffectComposer,
      `import { Canvas } from "@react-three/fiber";
       import { WebGLRenderer } from "three";
       import { EffectComposer } from "@react-three/postprocessing";
       const scene = <Canvas gl={async () => new WebGLRenderer()}><EffectComposer /></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
