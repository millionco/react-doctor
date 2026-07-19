import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuNoLegacyMaterialApi } from "./r3f-webgpu-no-legacy-material-api.js";

describe("r3f-webgpu-no-legacy-material-api", () => {
  it("requires the renderer-neutral R3F WebGPU release", () => {
    expect(r3fWebgpuNoLegacyMaterialApi.requires).toEqual(["r3f:10"]);
  });

  it("reports legacy shader intrinsics and onBeforeCompile below WebGPU Canvas", () => {
    const result = runRule(
      r3fWebgpuNoLegacyMaterialApi,
      `import { Canvas } from "@react-three/fiber/webgpu";
       const scene = <Canvas><mesh>
         <shaderMaterial vertexShader={vertex} fragmentShader={fragment} />
         <rawShaderMaterial />
         <meshStandardMaterial onBeforeCompile={patchShader} />
       </mesh></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("resolves aliased, namespace, CommonJS, and import-equals Canvas APIs", () => {
    const result = runRule(
      r3fWebgpuNoLegacyMaterialApi,
      `import * as Fiber from "@react-three/fiber/webgpu";
       const first = <Fiber.Canvas><shaderMaterial /></Fiber.Canvas>;
       const CommonJsFiber = require("@react-three/fiber/webgpu");
       const second = <CommonJsFiber.Canvas><rawShaderMaterial /></CommonJsFiber.Canvas>;
       import WebgpuFiber = require("@react-three/fiber/webgpu");
       const third = <WebgpuFiber.Canvas><meshBasicMaterial onBeforeCompile={patch} /></WebgpuFiber.Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows node materials, legacy Canvas, and nested legacy renderer boundaries", () => {
    const result = runRule(
      r3fWebgpuNoLegacyMaterialApi,
      `import { Canvas as WebgpuCanvas } from "@react-three/fiber/webgpu";
       import { Canvas as LegacyCanvas } from "@react-three/fiber/legacy";
       const nodeScene = <WebgpuCanvas><mesh><meshStandardNodeMaterial /></mesh></WebgpuCanvas>;
       const legacyScene = <LegacyCanvas><shaderMaterial /></LegacyCanvas>;
       const nested = <WebgpuCanvas><LegacyCanvas><rawShaderMaterial /></LegacyCanvas></WebgpuCanvas>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores custom components and authoritative unknown spreads", () => {
    const result = runRule(
      r3fWebgpuNoLegacyMaterialApi,
      `import { Canvas } from "@react-three/fiber/webgpu";
       const scene = <Canvas>
         <CustomMaterial onBeforeCompile={patch} />
         <meshStandardMaterial onBeforeCompile={patch} {...props} />
       </Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
