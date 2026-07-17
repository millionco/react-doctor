import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuCanvasPropCompatibility } from "./r3f-webgpu-canvas-prop-compatibility.js";

describe("r3f-webgpu-canvas-prop-compatibility", () => {
  it("reports legacy gl on the WebGPU Canvas", () => {
    const result = runRule(
      r3fWebgpuCanvasPropCompatibility,
      `import { Canvas as WebgpuCanvas } from "@react-three/fiber/webgpu";
       const scene = <WebgpuCanvas gl={{ antialias: true }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports renderer on the legacy Canvas and conflicting root props", () => {
    const result = runRule(
      r3fWebgpuCanvasPropCompatibility,
      `import * as Legacy from "@react-three/fiber/legacy";
       import { Canvas } from "@react-three/fiber";
       const first = <Legacy.Canvas renderer />;
       const second = <Canvas gl={{}} renderer={{}} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows the renderer prop for WebGPU and gl for legacy or root Canvas", () => {
    const result = runRule(
      r3fWebgpuCanvasPropCompatibility,
      `import { Canvas as WebgpuCanvas } from "@react-three/fiber/webgpu";
       import { Canvas as LegacyCanvas } from "@react-three/fiber/legacy";
       import { Canvas } from "@react-three/fiber";
       const first = <WebgpuCanvas renderer={{}} />;
       const second = <LegacyCanvas gl={{}} />;
       const third = <Canvas gl={{}} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a later spread makes the effective prop unknown", () => {
    const result = runRule(
      r3fWebgpuCanvasPropCompatibility,
      `import { Canvas } from "@react-three/fiber/webgpu";
       const scene = <Canvas gl={{}} {...props} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unrelated Canvas components", () => {
    const result = runRule(
      r3fWebgpuCanvasPropCompatibility,
      `import { Canvas } from "other-renderer"; const scene = <Canvas gl={{}} renderer={{}} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
