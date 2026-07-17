import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionValueSubscriptionInRender } from "./motion-value-subscription-in-render.js";

describe("motion-value-subscription-in-render", () => {
  it("reports direct and aliased Motion value subscriptions during render", () => {
    const result = runRule(
      motionValueSubscriptionInRender,
      `import { useMotionValue, useSpring } from "motion/react";
       const Meter = () => {
         const progress = useMotionValue(0);
         const alias = progress;
         alias.on("change", console.log);
         useSpring(progress).on("change", console.log);
         return <output>{progress.get()}</output>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows hook subscriptions and effect or event subscriptions", () => {
    const result = runRule(
      motionValueSubscriptionInRender,
      `import { useMotionValue, useMotionValueEvent } from "motion/react";
       import { useEffect } from "react";
       const Meter = () => {
         const progress = useMotionValue(0);
         useMotionValueEvent(progress, "change", console.log);
         useEffect(() => progress.on("change", console.log), [progress]);
         const onClick = () => progress.on("change", console.log);
         return <button onClick={onClick}>{progress.get()}</button>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores unrelated objects and same-named hooks", () => {
    const result = runRule(
      motionValueSubscriptionInRender,
      `const useMotionValue = () => emitter; const Meter = () => useMotionValue().on("change", log);`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
