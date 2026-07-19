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

  it("flags the second mount of the same static member path", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ model }) => <><primitive object={model.scene} /><primitive object={model["scene"]} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a single primitive site repeated by a statically multi-item map", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene }) => <>{["left", "right"].map((side) => <primitive key={side} object={scene} />)}</>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags exact immutable local callbacks used by a repeated map", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `
        ${R3F_RUNTIME_IMPORT}
        const Scene = ({ scene }) => {
          const renderPrimitive = (side) => <primitive key={side} object={scene} />;
          return ["left", "right"].map(renderPrimitive);
        };
        const Declared = ({ scene }) => {
          function renderPrimitive(side) {
            return <primitive key={side} object={scene} />;
          }
          return ["left", "right"].map(renderPrimitive);
        };
        const sharedScene = loadSharedScene();
        const renderSharedPrimitive = (side) => <primitive key={side} object={sharedScene} />;
        const ModuleCallback = () => ["left", "right"].map(renderSharedPrimitive);
      `,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("keeps conditional map mounts quiet", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `
        ${R3F_RUNTIME_IMPORT}
        const Logical = ({ scene }) => <>{[{ enabled: true }, { enabled: false }].map((item) => item.enabled && <primitive object={scene} />)}</>;
        const Ternary = ({ scene }) => <>{[{ enabled: true }, { enabled: false }].map((item) => item.enabled ? <primitive object={scene} /> : null)}</>;
        const EarlyReturn = ({ scene }) => <>{[{ enabled: true }, { enabled: false }].map((item) => {
          if (!item.enabled) return null;
          return <primitive object={scene} />;
        })}</>;
        const Named = ({ scene }) => {
          const renderPrimitive = (item) => item.enabled && <primitive object={scene} />;
          return [{ enabled: true }, { enabled: false }].map(renderPrimitive);
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps mutable callbacks and named per-item object callbacks quiet", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `
        ${R3F_RUNTIME_IMPORT}
        const Mutable = ({ scene }) => {
          let renderPrimitive = () => <primitive object={scene} />;
          renderPrimitive = () => null;
          return ["left", "right"].map(renderPrimitive);
        };
        const PerItem = ({ items }) => {
          const renderPrimitive = (item) => <primitive object={item.scene} />;
          return [items[0], items[1]].map(renderPrimitive);
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps unknown and singleton map cardinality quiet", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Unknown = ({ scene, items }) => <>{items.map((item) => <primitive key={item.id} object={scene} />)}</>; const Singleton = ({ scene }) => <>{["only"].map((key) => <primitive key={key} object={scene} />)}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps per-item and callback-local map objects quiet", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ items }) => <>{[items[0], items[1]].map((item) => { const scene = item.scene; return <primitive object={scene} />; })}</>; const Direct = ({ items }) => <>{[items[0], items[1]].map((item) => <primitive object={item.scene} />)}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("allows local elements selected by mutually exclusive render branches", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `
        ${R3F_RUNTIME_IMPORT}
        const Direct = ({ scene, detail }) => {
          const summary = <primitive object={scene} />;
          const expanded = <primitive object={scene} />;
          return detail ? expanded : summary;
        };
        const Aliased = ({ scene, detail }) => {
          const summary = <primitive object={scene} />;
          const expanded = <primitive object={scene} />;
          const content = detail ? expanded : summary;
          return content;
        };
        const Assigned = ({ scene, detail }) => {
          const summary = <primitive object={scene} />;
          const expanded = <primitive object={scene} />;
          let content;
          if (detail) content = expanded;
          else content = summary;
          return content;
        };
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags local elements that can both reach the render output", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene }) => { const first = <primitive object={scene} />; const second = <primitive object={scene} />; return <>{first}{second}</>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores unused local elements", () => {
    const result = runRule(
      r3fNoDuplicatePrimitiveObject,
      `${R3F_RUNTIME_IMPORT} const Scene = ({ scene }) => { const unused = <primitive object={scene} />; return <primitive object={scene} />; };`,
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
