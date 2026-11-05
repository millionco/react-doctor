import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnknownProperty } from "./no-unknown-property.js";

const CANVAS_IMPORT = 'import { Canvas } from "@react-three/fiber";';

describe("no-unknown-property R3F host ownership", () => {
  it.each([
    [
      "recognizes a direct Canvas child",
      `${CANVAS_IMPORT} export const Scene = () => <Canvas><line onUpdate={sync} /></Canvas>;`,
      0,
    ],
    [
      "recognizes a private component through value-only JSX wrappers",
      `import { Canvas as SceneHost } from "@react-three/fiber";
       const Plot = () => { return <><line onUpdate={sync} /><line onUpdate={sync} /></>; };
       export const Scene = () => <SceneHost>{shown ? <>{ready && <Plot />}</> : null}</SceneHost>;`,
      0,
    ],
    [
      "keeps other component declaration forms",
      `${CANVAS_IMPORT}
       function Plot() { return <line onUpdate={sync} />; }
       export const Scene = () => <Canvas><Plot /></Canvas>;`,
      1,
    ],
    [
      "keeps a sibling DOM line and an unrelated unknown R3F attribute",
      `${CANVAS_IMPORT}
       const Plot = () => <line onUpdate={sync} unknownProp={sync} />;
       export const Scene = () => <><Canvas><Plot /></Canvas><svg><line onUpdate={sync} /></svg></>;`,
      2,
    ],
    [
      "keeps a component used by both renderers",
      `${CANVAS_IMPORT}
       const Plot = () => <line onUpdate={sync} />;
       export const Scene = () => <><Canvas><Plot /></Canvas><svg><Plot /></svg></>;`,
      1,
    ],
    [
      "keeps direct and aliased exports",
      `${CANVAS_IMPORT}
       export const Direct = () => <line onUpdate={sync} />;
       const Indirect = () => <line onUpdate={sync} />;
       export { Indirect as Plot };
       export const Scene = () => <Canvas><Direct /><Indirect /></Canvas>;`,
      2,
    ],
    [
      "keeps direct invocations and escaped component bindings",
      `${CANVAS_IMPORT}
       const Called = () => <line onUpdate={sync} />;
       const Escaped = () => <line onUpdate={sync} />;
       route(Escaped);
       export const Scene = () => <><Canvas><Called /><Escaped /></Canvas>{Called()}</>;`,
      2,
    ],
    [
      "keeps a shadowed Canvas",
      `${CANVAS_IMPORT}
       const Plot = () => <line onUpdate={sync} />;
       export const Scene = ({ Canvas }) => <Canvas><Plot /></Canvas>;`,
      1,
    ],
    [
      "keeps other providers and locally aliased providers",
      `${CANVAS_IMPORT}
       import { Canvas as OtherCanvas } from "./wrapper";
       const Alias = Canvas;
       export const Scene = () => <><OtherCanvas><line onUpdate={sync} /></OtherCanvas>
       <Alias><line onUpdate={sync} /></Alias></>;`,
      2,
    ],
    [
      "keeps Canvas fallback while exempting actual children",
      `${CANVAS_IMPORT}
       const Fallback = () => <line onUpdate={sync} />;
       const Plot = () => <line onUpdate={sync} />;
       export const Scene = () => <Canvas fallback={<Fallback />}><Plot /></Canvas>;`,
      1,
    ],
    [
      "keeps JSX passed through a wrapper that can change the renderer",
      `${CANVAS_IMPORT}
       const Plot = () => <line onUpdate={sync} />;
       export const Scene = () => <Canvas><Opaque><Plot /></Opaque></Canvas>;`,
      1,
    ],
    [
      "keeps JSX returned through an opaque function from the local component",
      `${CANVAS_IMPORT}
       const Plot = () => portal(<line onUpdate={sync} />);
       export const Scene = () => <Canvas><Plot /></Canvas>;`,
      1,
    ],
    [
      "keeps a type-only provider",
      `import type { Canvas } from "@react-three/fiber";
       export const Scene = () => <Canvas><line onUpdate={sync} /></Canvas>;`,
      1,
    ],
    [
      "keeps a provider with a JSX spread",
      `${CANVAS_IMPORT}
       export const Scene = () => <Canvas {...options}><line onUpdate={sync} /></Canvas>;`,
      1,
    ],
    [
      "keeps a private binding that can escape through lexical eval",
      `${CANVAS_IMPORT}
       const Plot = () => <line onUpdate={sync} />;
       eval("consume(Plot)");
       export const Scene = () => <Canvas><Plot /></Canvas>;`,
      1,
    ],
  ] as const)("%s", (_label, code, expected) => {
    const result = runRule(noUnknownProperty, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it("keeps upstream behavior", () => {
    const result = runRule(
      noUnknownProperty,
      `${CANVAS_IMPORT} export const Scene = () => <Canvas><line onUpdate={sync} /></Canvas>;`,
      { settings: { "react-doctor": { portedRuleMode: "upstream" } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
