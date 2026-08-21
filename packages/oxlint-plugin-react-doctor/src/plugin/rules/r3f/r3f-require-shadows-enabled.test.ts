import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireShadowsEnabled } from "./r3f-require-shadows-enabled.js";

describe("r3f-require-shadows-enabled", () => {
  it("reports direct shadow users under a Canvas without shadows", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const Scene = () => (
        <Canvas>
          <directionalLight castShadow />
          <mesh receiveShadow />
        </Canvas>
      );
    `;
    expect(runRule(r3fRequireShadowsEnabled, code).diagnostics).toHaveLength(1);
  });

  it("allows enabled and dynamically configured shadow maps", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const Enabled = () => <Canvas shadows><mesh castShadow /></Canvas>;
      const Dynamic = ({ shadows }) => <Canvas shadows={shadows}><mesh castShadow /></Canvas>;
      const Created = () => <Canvas onCreated={configure}><mesh receiveShadow /></Canvas>;
      const Renderer = () => <Canvas gl={rendererOptions}><mesh castShadow /></Canvas>;
    `;
    expect(runRule(r3fRequireShadowsEnabled, code).diagnostics).toHaveLength(0);
  });

  it("ignores nested components and lookalike JSX", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const Model = () => <mesh castShadow />;
      const Scene = () => <Canvas><Model /></Canvas>;
      const Html = () => <div castShadow />;
    `;
    expect(runRule(r3fRequireShadowsEnabled, code).diagnostics).toHaveLength(0);
  });
});
