import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fValidPerspectiveCamera } from "./r3f-valid-perspective-camera.js";

describe("r3f-valid-perspective-camera", () => {
  it("reports invalid camera props and constructor args", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const Scene = () => (
        <>
          <perspectiveCamera aspect={0} />
          <perspectiveCamera near={0} far={1000} />
          <perspectiveCamera args={[75, 1, 100, 50]} />
          <Canvas camera={{ near: -1, far: 1000 }} />
          <Canvas camera={{ near: 10, far: 10 }} />
        </>
      );
    `;
    expect(runRule(r3fValidPerspectiveCamera, code).diagnostics).toHaveLength(5);
  });

  it("lets explicit props override constructor args", () => {
    const code = `
      import "@react-three/fiber";
      const Scene = () => (
        <>
          <perspectiveCamera args={[75, 0, 0, -1]} aspect={1} near={0.1} far={1000} />
          <perspectiveCamera args={[75, 1, 0.1, 1000]} />
        </>
      );
    `;
    expect(runRule(r3fValidPerspectiveCamera, code).diagnostics).toHaveLength(0);
  });

  it("allows dynamic and orthographic camera configuration", () => {
    const code = `
      import { Canvas } from "@react-three/fiber";
      const Scene = (props) => (
        <>
          <perspectiveCamera args={props.args} near={props.near} far={props.far} />
          <perspectiveCamera {...props} near={0} />
          <Canvas camera={{ near, far }} />
          <Canvas orthographic camera={{ near: -10, far: 10 }} />
        </>
      );
    `;
    expect(runRule(r3fValidPerspectiveCamera, code).diagnostics).toHaveLength(0);
  });

  it("ignores similarly named JSX outside R3F", () => {
    const code = `
      const Scene = () => <perspectiveCamera near={0} far={0} />;
    `;
    expect(runRule(r3fValidPerspectiveCamera, code).diagnostics).toHaveLength(0);
  });
});
