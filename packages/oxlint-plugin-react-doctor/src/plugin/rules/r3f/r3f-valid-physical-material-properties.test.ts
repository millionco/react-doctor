import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidPhysicalMaterialProperties } from "./r3f-valid-physical-material-properties.js";

describe("r3f-valid-physical-material-properties", () => {
  it("reports statically invalid physical material properties", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <Canvas>
        <meshPhysicalMaterial clearcoat={2} sheen={-1} ior={3} />
      </Canvas>;
    `;
    expect(runRule(r3fValidPhysicalMaterialProperties, code).diagnostics).toHaveLength(3);
  });

  it("allows valid, dynamic, spread, and standard materials", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = (props) => <Canvas>
        <meshPhysicalMaterial clearcoat={1} sheen={0} ior={1.5} />
        <meshPhysicalMaterial transmission={value} />
        <meshPhysicalMaterial {...props} clearcoat={2} />
        <meshStandardMaterial clearcoat={2} />
      </Canvas>;
    `;
    expect(runRule(r3fValidPhysicalMaterialProperties, code).diagnostics).toHaveLength(0);
  });
});
