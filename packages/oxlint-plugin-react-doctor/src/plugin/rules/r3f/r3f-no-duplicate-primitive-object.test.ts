import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoDuplicatePrimitiveObject } from "./r3f-no-duplicate-primitive-object.js";

const R3F_RUNTIME_IMPORT = `import { Canvas } from "@react-three/fiber";`;

describe("r3f-no-duplicate-primitive-object", () => {
  it("flags the second mount of the same binding", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene }) => <><primitive object={scene} /><primitive object={scene} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires a runtime R3F import", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `const Scene = ({ scene }) => <><primitive object={scene} /><primitive object={scene} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows separate bindings and separate component owners", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const First = ({ scene }) => <primitive object={scene} />; const Second = ({ scene }) => <primitive object={scene} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows mutually exclusive conditional mounts", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene, detail }) => detail ? <primitive object={scene} /> : <primitive object={scene} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows mutually exclusive if/else mounts", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene, detail }) => { let content; if (detail) { content = <primitive object={scene} />; } else { content = <primitive object={scene} />; } return content; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows mounts guarded by complementary logical expressions", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene, detail }) => <>{detail && <primitive object={scene} />}{!detail && <primitive object={scene} />}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows sibling ternary mounts with complementary identifier guards", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `
        ${R3F_RUNTIME_IMPORT}
        const First = ({ scene, detail }) => <>{detail ? <primitive object={scene} /> : null}{!detail ? <primitive object={scene} /> : null}</>;
        const Second = ({ scene, detail }) => <>{detail ? <primitive object={scene} /> : null}{detail ? null : <primitive object={scene} />}</>;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows complementary OR/AND and sibling if mounts", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `
        ${R3F_RUNTIME_IMPORT}
        const Logical = ({ scene, detail }) => <>{detail || <primitive object={scene} />}{detail && <primitive object={scene} />}</>;
        const Branches = ({ scene, detail }) => { let first = null; let second = null; if (detail) first = <primitive object={scene} />; if (!detail) second = <primitive object={scene} />; return <>{first}{second}</>; };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps opaque complementary ternary guards reportable", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene, detail }) => <>{detail.ready ? <primitive object={scene} /> : null}{!detail.ready ? <primitive object={scene} /> : null}</>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mount returned by an inline render helper alongside its parent", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene }) => <>{(() => { return <primitive object={scene} />; })()}<primitive object={scene} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores a memoized element that is not mounted", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} import { useMemo } from "react"; const Scene = ({ scene }) => { useMemo(() => <primitive object={scene} />, [scene]); return <primitive object={scene} />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores an inline render helper whose result is discarded", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene }) => <>{(() => { (() => <primitive object={scene} />)(); return null; })()}<primitive object={scene} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count object props hidden by a trailing JSX spread", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene, props }) => <><primitive object={scene} {...props} /><primitive object={scene} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("counts object props followed by a statically nonconflicting spread", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene }) => <><primitive object={scene} {...{ visible: true }} /><primitive object={scene} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
