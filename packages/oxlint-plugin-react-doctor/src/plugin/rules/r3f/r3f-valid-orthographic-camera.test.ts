import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidOrthographicCamera } from "./r3f-valid-orthographic-camera.js";

describe("r3f-valid-orthographic-camera", () => {
  it("reports invalid intrinsic and Canvas orthographic cameras", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = () => <>
        <Canvas orthographic camera={{ near: -1, far: 100 }} />
        <orthographicCamera args={[-1, 1, 1, -1, 10, 5]} />
        <orthographicCamera left={2} right={2} />
      </>;
    `;
    expect(runRule(r3fValidOrthographicCamera, code).diagnostics).toHaveLength(2);
  });

  it("allows valid, dynamic, spread, and perspective configurations", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      export const Scene = (props) => <>
        <Canvas orthographic camera={{ near: 0, far: 100 }} />
        <Canvas orthographic camera={{ near: -1, far: 1 }} />
        <Canvas orthographic={false} camera={{ near: -1, far: -2 }} />
        <orthographicCamera args={[-1, 1, 1, -1, 0, 100]} />
        <orthographicCamera {...props} near={-1} />
        <orthographicCamera args={[left, right, top, bottom, near, far]} />
      </>;
    `;
    expect(runRule(r3fValidOrthographicCamera, code).diagnostics).toHaveLength(0);
  });
});
