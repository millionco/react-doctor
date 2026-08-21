import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidSpotLightProperties } from "./r3f-valid-spot-light-properties.js";

describe("r3f-valid-spot-light-properties", () => {
  it("reports invalid props and constructor arguments", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <Canvas>
        <spotLight angle={2} penumbra={-1} />
        <spotLight args={[0xffffff, 1, 0, 0, 2]} />
      </Canvas>;
    `;
    expect(runRule(r3fValidSpotLightProperties, code).diagnostics).toHaveLength(4);
  });

  it("allows valid, dynamic, and spread configurations", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = (props) => <Canvas>
        <spotLight angle={Math.PI / 3} penumbra={0.5} />
        <spotLight angle={angle} penumbra={penumbra} />
        <spotLight {...props} angle={2} />
      </Canvas>;
    `;
    expect(runRule(r3fValidSpotLightProperties, code).diagnostics).toHaveLength(0);
  });
});
