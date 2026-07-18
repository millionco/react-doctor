import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionImperativeAnimationInRender } from "./motion-imperative-animation-in-render.js";

describe("motion-imperative-animation-in-render", () => {
  it("reports imported animate calls, animation controls, and Motion value writes during render", () => {
    const result = runRule(
      motionImperativeAnimationInRender,
      `import { animate, useAnimationControls, useMotionValue } from "motion/react";
       const Panel = () => {
         const controls = useAnimationControls();
         const progress = useMotionValue(0);
         animate(".panel", { opacity: 1 });
         controls.start({ opacity: 1 });
         progress.set(1);
         progress.jump(0);
         return <div />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("reports aliases and useAnimate tuple bindings", () => {
    const result = runRule(
      motionImperativeAnimationInRender,
      `import { useAnimate, useAnimation as useControls } from "framer-motion";
       const Panel = () => {
         const [, animatePanel] = useAnimate();
         const controls = useControls();
         const run = animatePanel;
         run(".panel", { x: 10 });
         controls.start({ x: 10 });
         return <div />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows effects, event handlers, deferred callbacks, and same-named userland APIs", () => {
    const result = runRule(
      motionImperativeAnimationInRender,
      `import { animate, useAnimationControls, useMotionValue } from "motion/react";
       import { useEffect } from "react";
       const Panel = () => {
         const controls = useAnimationControls();
         const progress = useMotionValue(0);
         useEffect(() => { animate(".panel", { opacity: 1 }); }, []);
         const onClick = () => controls.start({ opacity: 1 });
         const update = () => progress.set(1);
         return <button onClick={onClick} onPointerMove={update} />;
       };
       const animateLocal = () => {};
       const Local = () => animateLocal();`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
