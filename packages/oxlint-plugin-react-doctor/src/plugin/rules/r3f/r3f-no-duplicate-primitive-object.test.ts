import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoDuplicatePrimitiveObject } from "./r3f-no-duplicate-primitive-object.js";

describe("r3f-no-duplicate-primitive-object", () => {
  it("flags the second mount of the same binding", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `const Scene = ({ scene }) => <><primitive object={scene} /><primitive object={scene} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows separate bindings and separate component owners", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `const First = ({ scene }) => <primitive object={scene} />; const Second = ({ scene }) => <primitive object={scene} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows mutually exclusive conditional mounts", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `const Scene = ({ scene, detail }) => detail ? <primitive object={scene} /> : <primitive object={scene} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows mutually exclusive if/else mounts", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `const Scene = ({ scene, detail }) => { let content; if (detail) { content = <primitive object={scene} />; } else { content = <primitive object={scene} />; } return content; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows mounts guarded by complementary logical expressions", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `const Scene = ({ scene, detail }) => <>{detail && <primitive object={scene} />}{!detail && <primitive object={scene} />}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
