import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoShadowsOnUnsupportedLight } from "./r3f-no-shadows-on-unsupported-light.js";

describe("r3f-no-shadows-on-unsupported-light", () => {
  it("reports ambient and hemisphere lights configured to cast shadows", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = () => <><ambientLight castShadow /><hemisphereLight castShadow={true} /></>;
    `;
    expect(runRule(r3fNoShadowsOnUnsupportedLight, code).diagnostics).toHaveLength(2);
  });

  it("allows supported, disabled, dynamic, and non-R3F lights", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = ({ castShadow, props }) => <>
        <directionalLight castShadow />
        <pointLight castShadow />
        <ambientLight castShadow={false} />
        <ambientLight castShadow={castShadow} />
        <ambientLight castShadow {...props} />
      </>;
    `;
    expect(runRule(r3fNoShadowsOnUnsupportedLight, code).diagnostics).toHaveLength(0);
  });
});
