import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { motionLayoutOnInlineElement } from "./motion-layout-on-inline-element.js";

describe("motion-layout-on-inline-element", () => {
  it("reports explicitly inline Motion layout elements", () => {
    const result = runRule(
      motionLayoutOnInlineElement,
      `import { motion } from "motion/react";
       const Example = () => <>
         <motion.span layout style={{ display: "inline" }} />
         <motion.a layout={true} className="inline" />
         <motion.strong layout="position" className={"inline"} />
         <motion.em layout="size" className={\`inline\`} />
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("reports layoutId elements through aliases and namespace imports", () => {
    const result = runRule(
      motionLayoutOnInlineElement,
      `import { m as animated } from "framer-motion";
       import * as Motion from "motion/react";
       const activeId = "active";
       const Example = () => <>
         <animated.span layoutId="label" className="!inline" />
         <Motion.motion.a layoutId={activeId} style={{ display: "inline" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows disabled, missing, and dynamic layout props", () => {
    const result = runRule(
      motionLayoutOnInlineElement,
      `import { motion } from "motion/react";
       const Example = ({ shouldAnimate }) => <>
         <motion.span layout={false} className="inline" />
         <motion.span layout={shouldAnimate} className="inline" />
         <motion.span className="inline" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows explicit non-inline display modes", () => {
    const result = runRule(
      motionLayoutOnInlineElement,
      `import { motion } from "motion/react";
       const Example = () => <>
         <motion.span layout className="inline-block" />
         <motion.span layout className="flex" />
         <motion.span layout className="grid" />
         <motion.span layout style={{ display: "inline-flex" }} />
         <motion.span layout style={{ display: "block" }} />
         <motion.span layout className="inline" style={{ display: "block" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips conflicting, variant-only, and dynamic classes", () => {
    const result = runRule(
      motionLayoutOnInlineElement,
      `import { motion } from "motion/react";
       const Example = ({ className }) => <>
         <motion.span layout className="inline inline-block" />
         <motion.span layout className="inline flex" />
         <motion.span layout className="md:inline" />
         <motion.span layout className={className} />
         <motion.span layout className={\`inline \${className}\`} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses static inline style display ahead of class display", () => {
    const result = runRule(
      motionLayoutOnInlineElement,
      `import { motion } from "motion/react";
       const Example = ({ className }) => <>
         <motion.span layout className="inline-block" style={{ display: "inline" }} />
         <motion.span layout className={className} style={{ display: "inline" }} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips dynamic styles and spreads", () => {
    const result = runRule(
      motionLayoutOnInlineElement,
      `import { motion } from "motion/react";
       const Example = ({ display, style, props }) => <>
         <motion.span layout style={{ display }} />
         <motion.span layout style={style} className="inline" />
         <motion.span layout style={{ ...style, display: "inline" }} />
         <motion.span layout style={{ display: "inline", ...style }} />
         <motion.span layout className="inline" {...props} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores userland lookalikes and type-only imports", () => {
    const result = runRule(
      motionLayoutOnInlineElement,
      `import type { motion as MotionType } from "motion/react";
       const motion = { span: (props) => <span {...props} /> };
       const InlinePanel = (props) => <span {...props} />;
       const Example = () => <>
         <motion.span layout className="inline" />
         <InlinePanel layoutId="panel" className="inline" />
         <MotionType.span layout className="inline" />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
