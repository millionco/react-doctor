import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoObjectConstructionInRender } from "./three-no-object-construction-in-render.js";

describe("three-no-object-construction-in-render", () => {
  it.each([
    `import { Scene } from "three"; const View = () => { const scene = new Scene(); return <canvas />; };`,
    `import * as THREE from "three"; function useCamera() { return new THREE.PerspectiveCamera(); }`,
  ])("flags Three.js construction during React render", (code) => {
    expect(runRule(threeNoObjectConstructionInRender, code).diagnostics).toHaveLength(1);
  });

  it.each([
    `import { Scene } from "three"; const scene = new Scene(); const View = () => <canvas />;`,
    `import { Scene } from "three"; import { useMemo } from "react"; const View = () => { const scene = useMemo(() => new Scene(), []); return <canvas />; };`,
    `import { Scene } from "three"; const View = () => <button onClick={() => new Scene()} />;`,
    `import { Scene } from "other"; const View = () => { const scene = new Scene(); return <canvas />; };`,
  ])("allows stable, deferred, or unrelated construction", (code) => {
    expect(runRule(threeNoObjectConstructionInRender, code).diagnostics).toHaveLength(0);
  });
});
