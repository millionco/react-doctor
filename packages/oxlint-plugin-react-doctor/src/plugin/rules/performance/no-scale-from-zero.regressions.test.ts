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

  it("flags official tag namespace subpaths", () => {
    const result = run(`
      import * as ClientMotion from "motion/react-client";
      import * as LegacyClientMotion from "framer-motion/client";
      import * as CompactMotion from "motion/react-m";
      import { div as MotionDiv } from "framer-motion/m";

      export const Examples = () => (
        <>
          <ClientMotion.div initial={{ scale: 0 }} />
          <LegacyClientMotion.span exit={{ scale: 0 }} />
          <CompactMotion.section initial={{ scale: 0 }} />
          <MotionDiv initial={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("keeps lowercase JSX tags intrinsic despite colliding tag-namespace imports", () => {
    const result = run(`
      import { div, span as section, article as MotionArticle } from "framer-motion/m";

      export const Examples = () => (
        <>
          <div initial={{ scale: 0 }} />
          <section exit={{ scale: 0 }} />
          <MotionArticle initial={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat animation-only mini entrypoints as tag namespaces", () => {
    const result = run(`
      import * as FramerMini from "framer-motion/mini";
      import * as MotionMini from "motion/react-mini";

      export const Examples = () => (
        <>
          <FramerMini.div initial={{ scale: 0 }} />
          <MotionMini.section initial={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a root module namespace as a tag namespace", () => {
    const result = run(`
      import * as Framer from "framer-motion";

      export const Example = () => <Framer.div initial={{ scale: 0 }} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags proven motion factory and component aliases", () => {
    const result = run(`
      import { motion as motionFactory } from "framer-motion";
      import * as Framer from "motion/react";

      const Base = () => null;
      const factoryAlias = motionFactory as typeof motionFactory;
      const namespaceAlias = Framer;
      const namespaceFactory = namespaceAlias.motion;
      const MemberComponent = factoryAlias.div;
      const MemberAlias = MemberComponent;
      const CreatedComponent = motionFactory.create(Base);
      const LegacyComponent = motionFactory(Base);

      export const Examples = () => (
        <>
          <factoryAlias.div initial={{ scale: 0 }} />
          <namespaceFactory.span initial={{ scale: 0 }} />
          <MemberAlias initial={{ scale: 0 }} />
          <CreatedComponent exit={{ scale: 0 }} />
          <LegacyComponent initial={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(5);
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

  it("does not trust mutable or conditionally selected motion lookalikes", () => {
    const result = run(`
      import { motion } from "framer-motion";

      const Panel = () => null;
      let mutableFactory = motion;
      mutableFactory = { div: Panel };
      const MaybeAnimated = Math.random() > 0.5 ? motion.div : Panel;

      export const Examples = ({ isOpen }) => (
        <>
          <mutableFactory.div initial={{ scale: 0 }} />
          <MaybeAnimated initial={{ scale: 0 }} />
          <motion.div initial={isOpen ? { scale: 0 } : { scale: 1 }} />
          <motion.div initial={{ scale: isOpen ? 0 : 1 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat type-only or default imports as motion factories", () => {
    const result = run(`
      import type { motion as MotionType } from "framer-motion";
      import motion from "framer-motion";

      export const Examples = () => (
        <>
          <MotionType.div initial={{ scale: 0 }} />
          <motion.div initial={{ scale: 0 }} />
        </>
      );
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

  it("uses only the last authoritative duplicate prop", () => {
    const result = run(`
      import { motion } from "framer-motion";

      export const Examples = () => (
        <>
          <motion.div initial={{ scale: 0 }} initial={{ scale: 1 }} />
          <motion.div initial={{ scale: 1 }} initial={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
