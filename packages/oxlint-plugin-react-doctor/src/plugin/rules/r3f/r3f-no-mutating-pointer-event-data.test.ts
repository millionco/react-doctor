import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fNoMutatingPointerEventData } from "./r3f-no-mutating-pointer-event-data.js";

describe("r3f-no-mutating-pointer-event-data", () => {
  it("reports direct, aliased, destructured, and argument mutations", () => {
    const result = runRule(
      r3fNoMutatingPointerEventData,
      `import { Canvas } from "@react-three/fiber";
       const direct = <mesh onPointerMove={(event) => event.point.set(1, 2, 3)} />;
       const assigned = <mesh onPointerDown={(event) => { const point = event.point; point.x = 1; }} />;
       const destructured = <mesh onClick={({ point: hitPoint }) => hitPoint.applyMatrix4(matrix)} />;
       const converted = <mesh onPointerUp={(event) => object.worldToLocal(event.point)} />;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("reports mutations of shared ray, uv, and normal event data", () => {
    const result = runRule(
      r3fNoMutatingPointerEventData,
      `import { Canvas } from "@react-three/fiber";
       const scene = <mesh onPointerMove={(event) => {
         event.ray.origin.set(1, 2, 3);
         event.uv.x = 0;
         event.normal.normalize();
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows reads and mutations of owned copies", () => {
    const result = runRule(
      r3fNoMutatingPointerEventData,
      `import { Canvas } from "@react-three/fiber";
       const scene = <mesh onPointerMove={(event) => {
         const distance = event.point.distanceTo(origin);
         const localPoint = event.point.clone();
         object.worldToLocal(localPoint);
         scratch.copy(event.point);
         scratch.copy(event.normal);
         ownedRay.copy(event.ray);
         consume(distance, localPoint, event.point.x);
       }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects aliases, useCallback, and authoritative JSX spreads", () => {
    const result = runRule(
      r3fNoMutatingPointerEventData,
      `const Fiber = require("@react-three/fiber");
       const React = require("react");
       const handler = React.useCallback((event) => event["point"].normalize(), []);
       const unknown = <mesh onPointerMove={handler} {...props} />;
       const known = <mesh {...props} onPointerMove={handler} />;
       const transparent = <mesh onPointerMove={handler} {...{ visible: true }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores DOM, custom-element, unrelated, and imported handlers", () => {
    const result = runRule(
      r3fNoMutatingPointerEventData,
      `import { Canvas } from "@react-three/fiber";
       import { handler } from "./handler";
       const dom = <div onPointerMove={(event) => event.point.set(1, 2, 3)} />;
       const custom = <model-viewer onPointerMove={(event) => event.point.set(1, 2, 3)} />;
       const imported = <mesh onPointerMove={handler} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
