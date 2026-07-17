import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoInlinePrimitiveObject } from "./r3f-no-inline-primitive-object.js";

describe("r3f-no-inline-primitive-object", () => {
  it("flags an inline clone", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `const Scene = () => <primitive object={scene.clone()} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a stable object binding", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `const Scene = ({ scene }) => <primitive object={scene} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows primitive JSX created once in a stable context", () => {
    const result = runRule(
      r3fNoInlinePrimitiveObject,
      `import { useMemo, useState } from "react"; const moduleNode = <primitive object={scene.clone()} />; const Scene = () => { const memoized = useMemo(() => <primitive object={scene.clone()} />, []); const [lazy] = useState(() => <primitive object={scene.clone()} />); return <>{memoized}{lazy}</>; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
