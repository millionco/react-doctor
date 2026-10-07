import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoIgnoredBasicMaterialProperties } from "./r3f-no-ignored-basic-material-properties.js";

describe("r3f-no-ignored-basic-material-properties", () => {
  it("reports PBR-only props on meshBasicMaterial", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = () => (
        <>
          <meshBasicMaterial color="red" roughness={0.4} />
          <meshBasicMaterial metalness={0.8} />
        </>
      );
    `;
    expect(runRule(r3fNoIgnoredBasicMaterialProperties, code).diagnostics).toHaveLength(2);
  });

  it("allows supported basic props and PBR material props", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = () => (
        <>
          <meshBasicMaterial color="red" map={texture} wireframe />
          <meshStandardMaterial roughness={0.4} metalness={0.8} />
          <meshPhysicalMaterial roughness={0.2} metalness={1} />
        </>
      );
    `;
    expect(runRule(r3fNoIgnoredBasicMaterialProperties, code).diagnostics).toHaveLength(0);
  });

  it("ignores overridden props and similarly named JSX outside R3F", () => {
    const r3fCode = `
      import "@react-three/fiber";
      const Scene = (props) => <meshBasicMaterial roughness={0.4} {...props} />;
    `;
    const customCode = `
      const Scene = () => <meshBasicMaterial roughness={0.4} metalness={0.8} />;
    `;
    expect(runRule(r3fNoIgnoredBasicMaterialProperties, r3fCode).diagnostics).toHaveLength(0);
    expect(runRule(r3fNoIgnoredBasicMaterialProperties, customCode).diagnostics).toHaveLength(0);
  });
});
