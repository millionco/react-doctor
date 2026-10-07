import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidMaterialOpacity } from "./r3f-valid-material-opacity.js";

describe("r3f-valid-material-opacity", () => {
  it("reports static material opacity outside zero and one", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = () => <><meshBasicMaterial opacity={-0.1} /><meshStandardMaterial opacity={1.2} /></>;
    `;
    expect(runRule(r3fValidMaterialOpacity, code).diagnostics).toHaveLength(2);
  });

  it("allows normalized, dynamic, spread, and non-material opacity", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = ({ opacity, props }) => <>
        <meshBasicMaterial opacity={0} />
        <meshStandardMaterial opacity={1} />
        <meshPhysicalMaterial opacity={opacity} />
        <meshBasicMaterial {...props} opacity={2} />
        <mesh opacity={2} />
      </>;
    `;
    expect(runRule(r3fValidMaterialOpacity, code).diagnostics).toHaveLength(0);
  });
});
