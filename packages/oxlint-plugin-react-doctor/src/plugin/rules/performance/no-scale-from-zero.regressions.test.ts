import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noScaleFromZero } from "./no-scale-from-zero.js";

const run = (code: string) => runRule(noScaleFromZero, code, { filename: "fixture.tsx" });

describe("performance/no-scale-from-zero — regressions", () => {
  it("does not treat an ordinary initial data prop as animation state", () => {
    const result = run(`
      interface PanelProps {
        initial: { scale: number };
      }

      const Panel = ({ initial }: PanelProps) => <output>{initial.scale}</output>;
      export const Candidate = () => <Panel initial={{ scale: 0 }} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat imported or intrinsic initial props as animation state", () => {
    const result = run(`
      import { Panel } from "./panel";

      export const Examples = () => (
        <>
          <Panel initial={{ scale: 0 }} />
          <div initial={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust userland motion lookalikes", () => {
    const result = run(`
      import { motion as importedMotion } from "./animation";

      const LocalPanel = () => null;
      const motion = { div: LocalPanel };

      export const Examples = () => (
        <>
          <motion.div initial={{ scale: 0 }} />
          <importedMotion.div initial={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags scale zero on direct and aliased motion factory imports", () => {
    const result = run(`
      import { motion, m as compactMotion } from "framer-motion";
      import { motion as aliasedMotion } from "motion/react";

      export const Examples = () => (
        <>
          <motion.div initial={{ scale: 0 }} />
          <compactMotion.span exit={{ scale: 0 }} />
          <aliasedMotion.section initial={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags scale zero through motion namespace imports", () => {
    const result = run(`
      import * as Framer from "framer-motion";
      import * as MotionReact from "motion/react";

      export const Examples = () => (
        <>
          <Framer.motion.div initial={{ scale: 0 }} />
          <MotionReact.m.span exit={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust a shadow of a motion import", () => {
    const result = run(`
      import { motion } from "framer-motion";

      const Panel = () => null;
      export const Example = () => {
        const motion = { div: Panel };
        return <motion.div initial={{ scale: 0 }} />;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays conservative when a later spread can replace initial", () => {
    const result = run(`
      import { motion } from "framer-motion";

      export const Example = ({ props }) => (
        <motion.div initial={{ scale: 0 }} {...props} />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags an explicit initial prop that follows a spread", () => {
    const result = run(`
      import { motion } from "framer-motion";

      export const Example = ({ props }) => (
        <motion.div {...props} initial={{ scale: 0 }} />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
