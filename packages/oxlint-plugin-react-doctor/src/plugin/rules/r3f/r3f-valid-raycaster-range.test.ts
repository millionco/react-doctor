import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidRaycasterRange } from "./r3f-valid-raycaster-range.js";

describe("r3f-valid-raycaster-range", () => {
  it("reports invalid Canvas and intrinsic raycasters", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <>
        <Canvas raycaster={{ near: -1, far: 100 }} />
        <raycaster args={[origin, direction, 10, 5]} />
      </>;
    `;
    expect(runRule(r3fValidRaycasterRange, code).diagnostics).toHaveLength(2);
  });

  it("allows valid, dynamic, and spread configurations", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = (props) => <>
        <Canvas raycaster={{ near: 0, far: 100 }} />
        <Canvas raycaster={{ near, far }} />
        <raycaster args={[origin, direction, 0, 100]} />
        <raycaster {...props} near={-1} />
      </>;
    `;
    expect(runRule(r3fValidRaycasterRange, code).diagnostics).toHaveLength(0);
  });
});
