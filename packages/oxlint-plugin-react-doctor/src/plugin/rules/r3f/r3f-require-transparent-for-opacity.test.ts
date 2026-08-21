import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireTransparentForOpacity } from "./r3f-require-transparent-for-opacity.js";

describe("r3f-require-transparent-for-opacity", () => {
  it("reports opacity below one without an active transparency mode", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = () => <><meshBasicMaterial opacity={0.5} /><meshStandardMaterial opacity={0.2} transparent={false} /></>;
    `;
    expect(runRule(r3fRequireTransparentForOpacity, code).diagnostics).toHaveLength(2);
  });

  it("allows transparent, hashed, tested, opaque, dynamic, and spread configurations", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = ({ opacity, props, transparent }) => <>
        <meshBasicMaterial opacity={0.5} transparent />
        <meshBasicMaterial opacity={0.5} alphaHash />
        <meshBasicMaterial opacity={0.5} alphaTest={0.1} />
        <meshBasicMaterial opacity={1} />
        <meshBasicMaterial opacity={opacity} />
        <meshBasicMaterial opacity={0.5} transparent={transparent} />
        <meshBasicMaterial {...props} opacity={0.5} />
      </>;
    `;
    expect(runRule(r3fRequireTransparentForOpacity, code).diagnostics).toHaveLength(0);
  });

  it("allows materials that Three.js makes transparent by default", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = () => <>
        <shadowMaterial opacity={0.2} />
        <spriteMaterial opacity={0.5} />
        <shadowNodeMaterial opacity={0.2} />
        <spriteNodeMaterial opacity={0.5} />
        <volumeNodeMaterial opacity={0.4} />
      </>;
    `;
    expect(runRule(r3fRequireTransparentForOpacity, code).diagnostics).toHaveLength(0);
  });
});
