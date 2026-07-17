import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStaticMotionConfigNever } from "./no-static-motion-config-never.js";

describe("no-static-motion-config-never", () => {
  it("flags a named MotionConfig import that always disables reduction", () => {
    const result = runRule(
      noStaticMotionConfigNever,
      `import { MotionConfig } from "motion/react";
       const App = () => <MotionConfig reducedMotion="never"><main /></MotionConfig>;`,
      { filename: "/repo/src/App.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags aliases and namespace imports", () => {
    const result = runRule(
      noStaticMotionConfigNever,
      `import { MotionConfig as AnimationPolicy } from "framer-motion";
       import * as Motion from "motion/react";
       const A = () => <AnimationPolicy reducedMotion="never" />;
       const B = () => <Motion.MotionConfig reducedMotion={"never"} />;`,
      { filename: "/repo/app/layout.tsx" },
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts user-aware and dynamic policies", () => {
    const result = runRule(
      noStaticMotionConfigNever,
      `import { MotionConfig } from "motion/react";
       const A = () => <MotionConfig reducedMotion="user" />;
       const B = ({ preference }) => <MotionConfig reducedMotion={preference} />;
       const C = () => <MotionConfig reducedMotion={process.env.NODE_ENV === "production" ? "user" : "never"} />;`,
      { filename: "/repo/src/main.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips custom and shadowed components", () => {
    const result = runRule(
      noStaticMotionConfigNever,
      `import { MotionConfig as ImportedConfig } from "motion/react";
       const MotionConfig = ({ children }) => children;
       const A = () => <MotionConfig reducedMotion="never" />;
       const B = () => <ImportedConfig reducedMotion="never" {...props} />;`,
      { filename: "/repo/src/App.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips subtree policies that may exempt essential motion", () => {
    const result = runRule(
      noStaticMotionConfigNever,
      `import { MotionConfig } from "motion/react";
       const Game = () => <MotionConfig reducedMotion="never"><canvas /></MotionConfig>;`,
      { filename: "/repo/src/components/game/game-loader.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
