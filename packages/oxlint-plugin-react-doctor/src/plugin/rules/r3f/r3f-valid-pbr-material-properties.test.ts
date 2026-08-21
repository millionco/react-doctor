import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidPbrMaterialProperties } from "./r3f-valid-pbr-material-properties.js";

describe("r3f-valid-pbr-material-properties", () => {
  it("reports static roughness and metalness values outside zero and one", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const TOO_ROUGH = 1 + 0.25;
      const Scene = () => (
        <Canvas>
          <meshStandardMaterial roughness={TOO_ROUGH} />
          <meshPhysicalMaterial metalness={-0.1} />
        </Canvas>
      );
    `;
    expect(runRule(r3fValidPbrMaterialProperties, code).diagnostics).toHaveLength(2);
  });

  it("allows normalized, dynamic, spread, and unrelated material properties", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const Scene = ({ roughness, materialProps }) => (
        <Canvas>
          <meshStandardMaterial roughness={0} metalness={1} />
          <meshPhysicalMaterial roughness={roughness} />
          <meshStandardMaterial {...materialProps} roughness={2} />
          <meshBasicMaterial roughness={2} />
        </Canvas>
      );
    `;
    expect(runRule(r3fValidPbrMaterialProperties, code).diagnostics).toHaveLength(0);
  });

  it("ignores lookalike JSX without an R3F import", () => {
    expect(
      runRule(
        r3fValidPbrMaterialProperties,
        `const View = () => <meshStandardMaterial roughness={2} />;`,
      ).diagnostics,
    ).toHaveLength(0);
  });
});
