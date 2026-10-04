import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoIgnoredLinewidth } from "./r3f-no-ignored-linewidth.js";

describe("r3f-no-ignored-linewidth", () => {
  it("reports nondefault static widths", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <Canvas>
        <lineBasicMaterial linewidth={4} />
        <lineDashedMaterial linewidth={2} />
      </Canvas>;
    `;
    expect(runRule(r3fNoIgnoredLinewidth, code).diagnostics).toHaveLength(2);
  });

  it("allows one, dynamic, spread, and Drei lines", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      import { Line } from "@react-three/drei";
      export const Scene = (props) => <Canvas>
        <lineBasicMaterial linewidth={1} />
        <lineBasicMaterial linewidth={width} />
        <lineBasicMaterial {...props} linewidth={4} />
        <Line lineWidth={4} />
      </Canvas>;
    `;
    expect(runRule(r3fNoIgnoredLinewidth, code).diagnostics).toHaveLength(0);
  });
});
