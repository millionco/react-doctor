import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fLimitShadowedPointLights } from "./r3f-limit-shadowed-point-lights.js";

describe("r3f-limit-shadowed-point-lights", () => {
  it("reports the third and later statically shadowed point lights in one scene", () => {
    const result = runRule(
      r3fLimitShadowedPointLights,
      `
        import { Canvas } from "@react-three/fiber";
        const enabled = true as boolean;
        const Scene = () => (
          <group>
            <pointLight castShadow />
            <pointLight castShadow={true} />
            <pointLight castShadow={enabled} />
            <pointLight castShadow />
          </group>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("counts across fragments and nested intrinsic groups", () => {
    const result = runRule(
      r3fLimitShadowedPointLights,
      `
        import "@react-three/fiber";
        const Scene = () => <>
          <pointLight castShadow />
          <group><pointLight castShadow /></group>
          <group><pointLight castShadow /></group>
        </>;
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes R3F ecosystem packages without a direct Fiber import", () => {
    const result = runRule(
      r3fLimitShadowedPointLights,
      `
        import { Root } from "@react-three/uikit";
        const Scene = () => <>
          <Root />
          <pointLight castShadow />
          <pointLight castShadow />
          <pointLight castShadow />
        </>;
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows two shadowed point lights and non-shadowed lights", () => {
    const result = runRule(
      r3fLimitShadowedPointLights,
      `
        import "@react-three/fiber";
        const Scene = () => <group>
          <pointLight castShadow />
          <pointLight castShadow={true} />
          <pointLight />
          <pointLight castShadow={false} />
          <directionalLight castShadow />
        </group>;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps separate returned roots and component boundaries separate", () => {
    const result = runRule(
      r3fLimitShadowedPointLights,
      `
        import "@react-three/fiber";
        const Left = () => <><pointLight castShadow /><pointLight castShadow /></>;
        const Right = () => <><pointLight castShadow /><pointLight castShadow /></>;
        const Scene = ({ alternate }) => alternate
          ? <><pointLight castShadow /><pointLight castShadow /></>
          : <><pointLight castShadow /><pointLight castShadow /></>;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores spreads, dynamic castShadow values, wrappers, and dynamic branches", () => {
    const result = runRule(
      r3fLimitShadowedPointLights,
      `
        import "@react-three/fiber";
        const Scene = ({ shadows, props, enabled }) => <group>
          <pointLight castShadow />
          <pointLight castShadow />
          <pointLight {...props} castShadow />
          <pointLight castShadow={shadows} />
          <ShadowedPointLight castShadow />
          {enabled && <pointLight castShadow />}
          {enabled ? <pointLight castShadow /> : <pointLight castShadow />}
        </group>;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores shadowed values named true and files without R3F", () => {
    const withoutR3f = runRule(
      r3fLimitShadowedPointLights,
      `const Scene = () => <><pointLight castShadow /><pointLight castShadow /><pointLight castShadow /></>;`,
    );
    const shadowedValue = runRule(
      r3fLimitShadowedPointLights,
      `
        import "@react-three/fiber";
        const Scene = ({ true: enabled }) => <>
          <pointLight castShadow />
          <pointLight castShadow />
          <pointLight castShadow={enabled} />
        </>;
      `,
    );
    expect(withoutR3f.diagnostics).toHaveLength(0);
    expect(shadowedValue.diagnostics).toHaveLength(0);
  });
});
