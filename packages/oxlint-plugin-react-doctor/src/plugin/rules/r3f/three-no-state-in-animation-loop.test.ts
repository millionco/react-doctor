import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoStateInAnimationLoop } from "./three-no-state-in-animation-loop.js";

describe("three-no-state-in-animation-loop", () => {
  it("flags an unguarded React state update inside setAnimationLoop", () => {
    const result = runRule(
      threeNoStateInAnimationLoop,
      `import { useState } from "react";
       import { WebGLRenderer } from "three";
       const Scene = () => {
         const [, setFrame] = useState(0);
         const renderer = new WebGLRenderer();
         renderer.setAnimationLoop(() => setFrame((frame) => frame + 1));
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags state updates reached through local helpers", () => {
    const result = runRule(
      threeNoStateInAnimationLoop,
      `import React from "react";
       import * as THREE from "three";
       const Scene = () => {
         const [, setFrame] = React.useState(0);
         const updateReact = () => setFrame(Date.now());
         const renderer = new THREE.WebGLRenderer();
         renderer.setAnimationLoop(() => updateReact());
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows state transitions guarded by a changing value", () => {
    const result = runRule(
      threeNoStateInAnimationLoop,
      `import { useState } from "react";
       import { WebGLRenderer } from "three";
       const Scene = ({ currentLevel, previousLevel }) => {
         const [, setLevel] = useState(currentLevel);
         const renderer = new WebGLRenderer();
         renderer.setAnimationLoop(() => {
           if (currentLevel !== previousLevel) setLevel(currentLevel);
         });
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores shadowed state hooks and unrelated animation schedulers", () => {
    const result = runRule(
      threeNoStateInAnimationLoop,
      `const useState = () => [0, update];
       const [, setFrame] = useState();
       scheduler.setAnimationLoop(() => setFrame(1));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
