import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidFogParameters } from "./r3f-valid-fog-parameters.js";

describe("r3f-valid-fog-parameters", () => {
  it("reports invalid args and property forms", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <Canvas>
        <fog args={["white", -1, 10]} />
        <fog near={10} far={5} />
        <fogExp2 args={["white", -0.1]} />
      </Canvas>;
    `;
    expect(runRule(r3fValidFogParameters, code).diagnostics).toHaveLength(3);
  });

  it("allows valid, dynamic, custom, and non-R3F fog", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <Canvas>
        <fog args={["white", 0, 100]} />
        <fog near={near} far={far} />
        <fogExp2 density={0.1} />
        <Fog near={-1} far={0} />
      </Canvas>;
    `;
    expect(runRule(r3fValidFogParameters, code).diagnostics).toHaveLength(0);
    expect(runRule(r3fValidFogParameters, "<fog near={-1} far={0} />;").diagnostics).toHaveLength(
      0,
    );
  });
});
