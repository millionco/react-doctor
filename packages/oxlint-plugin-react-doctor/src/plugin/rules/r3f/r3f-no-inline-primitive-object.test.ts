import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoInlinePrimitiveObject } from "./r3f-no-inline-primitive-object.js";

describe("r3f-no-inline-primitive-object", () => {
  it("flags an inline clone", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `import { Canvas } from "@react-three/fiber"; const Scene = () => <primitive object={scene.clone()} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags fluent fresh instances and global Object.create values", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `import { Canvas } from "@react-three/fiber"; import { Group } from "three"; const Scene = () => <><primitive object={new Group().add(child)} /><primitive object={Object.create(prototype)} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps stable fluent values, unknown add receivers, and shadowed Object.create quiet", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `import { Canvas } from "@react-three/fiber"; import { Group } from "three"; const stable = new Group().add(child); const Scene = ({ builder, Object }) => <><primitive object={stable} /><primitive object={builder.add(child)} /><primitive object={Object.create(prototype)} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a runtime R3F import", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `const Scene = () => <primitive object={scene.clone()} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `const Fiber = require("@react-three/fiber"); const Scene = () => <primitive object={model.clone()} />;`,
    `require("@react-three/fiber"); const Scene = () => <primitive object={model.clone()} />;`,
    `import Fiber = require("@react-three/fiber"); const Scene = () => <primitive object={model.clone()} />;`,
  ])("recognizes CommonJS R3F runtime evidence", (code) => {
    const result = runRule(r3fNoInlinePrimitiveObject, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores shadowed CommonJS runtime evidence", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `const require = loadModule; require("@react-three/fiber"); const Scene = () => <primitive object={model.clone()} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a stable object binding", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `import { Canvas } from "@react-three/fiber"; const Scene = ({ scene }) => <primitive object={scene} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows primitive JSX created once in a stable context", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `import { Canvas } from "@react-three/fiber"; import { useMemo, useState } from "react"; const moduleNode = <primitive object={scene.clone()} />; const Scene = () => { const memoized = useMemo(() => <primitive object={scene.clone()} />, []); const [lazy] = useState(() => <primitive object={scene.clone()} />); return <>{memoized}{lazy}</>; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects JSX spread override order", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `import { Canvas } from "@react-three/fiber"; const Scene = ({ props }) => <><primitive object={scene.clone()} {...props} /><primitive {...props} object={scene.clone()} /><primitive object={scene.clone()} {...{ visible: true }} /><primitive object={scene.clone()} {...{ object: stableScene }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows JSX stabilized by CommonJS React useMemo", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `const Fiber = require("@react-three/fiber"); const React = require("react"); const Scene = () => React.useMemo(() => <primitive object={model.clone()} />, [model]);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
