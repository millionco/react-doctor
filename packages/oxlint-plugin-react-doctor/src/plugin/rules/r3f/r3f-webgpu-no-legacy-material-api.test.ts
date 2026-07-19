import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fWebgpuNoLegacyMaterialApi } from "./r3f-webgpu-no-legacy-material-api.js";

describe("r3f-webgpu-no-legacy-material-api", () => {
  it("runs for stable-v9 Canvas WebGPU factories", () => {
    expect(r3fWebgpuNoLegacyMaterialApi.requires).toBeUndefined();
  });

  it("reports stable Canvas and memoized same-file material indirection", () => {
    const result = runRule(
      r3fWebgpuNoLegacyMaterialApi,
      `import React from "react";
       import { Canvas } from "@react-three/fiber";
       import { WebGPURenderer } from "three/webgpu";
       const LegacyMaterial = React.memo(() => <shaderMaterial />);
       const scene = <Canvas gl={async (props) => new WebGPURenderer(props)}><LegacyMaterial /></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows two-hop and three-hop immutable local component ancestry", () => {
    const result = runRule(
      r3fWebgpuNoLegacyMaterialApi,
      `import { Canvas } from "@react-three/fiber/webgpu";
       const TwoHopMaterial = () => <shaderMaterial />;
       const TwoHopScene = () => <TwoHopMaterial />;
       const ThreeHopMaterial = () => <rawShaderMaterial />;
       const ThreeHopMiddle = () => <ThreeHopMaterial />;
       const ThreeHopScene = () => <ThreeHopMiddle />;
       const first = <Canvas><TwoHopScene /></Canvas>;
       const second = <Canvas><ThreeHopScene /></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
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

  it("does not project WebGPU ancestry through imported or WebGL-backed components", () => {
    const result = runRule(
      r3fWebgpuNoLegacyMaterialApi,
      `import { Canvas } from "@react-three/fiber";
       import { WebGLRenderer } from "three";
       const LocalMaterial = () => <shaderMaterial />;
       const scene = <Canvas gl={async () => new WebGLRenderer()}><LocalMaterial /></Canvas>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects cyclic, dynamic, imported, and legacy-boundary ancestry proofs", () => {
    const result = runRule(
      r3fWebgpuNoLegacyMaterialApi,
      `import { Canvas as WebgpuCanvas } from "@react-three/fiber/webgpu";
       import { Canvas as LegacyCanvas } from "@react-three/fiber/legacy";
       import { ImportedScene } from "./scene";
       const CyclicMaterial = () => <><CyclicScene /><shaderMaterial /></>;
       const CyclicScene = () => <CyclicMaterial />;
       const DynamicMaterial = () => <rawShaderMaterial />;
       const SafeMaterial = () => null;
       const SelectedMaterial = condition ? DynamicMaterial : SafeMaterial;
       let MutableMaterial = () => <shaderMaterial />;
       const ImportedMaterial = () => <meshStandardMaterial onBeforeCompile={patch} />;
       const BoundedMaterial = () => <shaderMaterial />;
       const LegacyBoundary = () => <LegacyCanvas><BoundedMaterial /></LegacyCanvas>;
       const dynamic = <WebgpuCanvas><SelectedMaterial /></WebgpuCanvas>;
       const mutable = <WebgpuCanvas><MutableMaterial /></WebgpuCanvas>;
       const imported = <WebgpuCanvas><ImportedScene content={ImportedMaterial} /></WebgpuCanvas>;
       const bounded = <WebgpuCanvas><LegacyBoundary /></WebgpuCanvas>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
