import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noScaleFromZero } from "./no-scale-from-zero.js";

const run = (code: string) => runRule(noScaleFromZero, code, { filename: "fixture.tsx" });

describe("performance/no-scale-from-zero — regressions", () => {
  it("flags inline and Tailwind scale-zero transitions", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scale(0)", transition: "transform 200ms ease-out" }} />
          <div className="scale-0 transition-transform" />
        </>
      );
    `);

    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays silent on static scale-zero states", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scale(0)" }} />
          <div className="scale-0" />
        </>
      );
    `);

    expect(result.diagnostics).toEqual([]);
  });

  it("lets important scale and transition setters win normal utilities", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="!scale-100 scale-0 transition-transform" />
          <div className="scale-0 !transition-none transition-transform" />
          <div className="!scale-0 scale-100 transition-transform" />
          <div className="scale-0 !transition-transform transition-none" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet for equal-priority conflicting scale and transition setters", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-100 scale-0 transition-transform" />
          <div className="scale-0 transition-none transition-transform" />
          <div className="!scale-100 scale-0! transition-transform" />
          <div className="scale-0 !transition-none transition-transform!" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the most-specific applicable scale and transition setters", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-100 hover:scale-0 hover:transition-transform" />
          <div className="scale-0 hover:scale-100 hover:transition-transform" />
          <div className="hover:scale-0 transition-none hover:transition-transform" />
          <div className="hover:scale-0 transition-transform hover:transition-none" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not pair scale and transition utilities across unrelated variant scopes", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="motion-safe:scale-0 motion-reduce:transition-transform" />
          <div className="dark:scale-0 hover:transition-transform" />
          <div className="motion-safe:scale-0 motion-safe:transition-transform" />
          <div className="scale-0 motion-safe:transition-transform" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes exact zero in an arbitrary scale utility", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-[0] transition-transform" />
          <div className="scale-[0.0] transition-transform" />
          <div className="scale-[0.01] transition-transform" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("normalizes multi-axis arbitrary scale values", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-[0_0] transition-transform" />
          <div className="scale-[0%_0.0] transition-transform" />
          <div className="scale-[0_1] transition-transform" />
          <div className="scale-[var(--scale)] transition-transform" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes arbitrary transform utilities containing zero scale", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="[transform:scale(0)] transition-transform" />
          <div className="transform-[translateX(1px)_scale(0)] transition-transform" />
          <div className="[transform:scale(.5)] transition-transform" />
          <div className="[transform:translateX(0)] transition-transform" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes axis-specific zero scale utilities", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-x-0 transition-transform" />
          <div className="scale-y-0 transition-transform" />
          <div className="scale-x-[0] transition-transform" />
          <div className="scale-y-100 transition-transform" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("requires Tailwind capability for class diagnostics", () => {
    const result = runRule(
      noScaleFromZero,
      `const A = () => <><div className="scale-0 transition-transform" /><div style={{ transform: "scale(0)", transition: "transform 200ms" }} /></>;`,
      {
        filename: "fixture.tsx",
        settings: { "react-doctor": { capabilities: [] } },
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects zero-duration Tailwind overrides in matching scopes", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-0 transition-transform duration-0" />
          <div className="hover:scale-0 hover:transition-transform hover:duration-0" />
          <div className="!scale-0 !transition-transform !duration-0" />
          <div className="scale-0 transition-transform !duration-0" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("combines arbitrary transition shorthands with positive durations", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-0 [transition:transform] duration-200" />
          <div className="hover:scale-x-0 hover:[transition:transform] hover:duration-[200ms]" />
          <div className="scale-y-0 [transition-property:transform] duration-200" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("evaluates duration-only variant scopes with inherited scale transitions", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-0 transition-transform duration-0 md:hover:duration-200" />
          <div className="!scale-0 !transition-transform !duration-0 md:hover:!duration-200" />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("merges Tailwind and inline scale transition declarations by CSS property", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="scale-0 transition-transform duration-200" style={{ transitionDuration: "0s" }} />
          <div className="scale-0" style={{ transition: "transform 200ms" }} />
          <div className="transition-transform duration-200" style={{ transform: "scale(0)" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves readonly const style objects and aliases", () => {
    const result = run(`
      const unsafeStyle = { transform: "scale(0)", transition: "transform 200ms" };
      const unsafeAlias = unsafeStyle;
      const safeOverride = { transform: "none" };
      export const Examples = () => (
        <>
          <div style={unsafeStyle} />
          <div style={unsafeAlias} />
          <div className="scale-0 transition-transform" style={safeOverride} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet for mutable style object bindings", () => {
    const result = run(`
      const changedStyle = { transform: "scale(0)", transition: "transform 200ms" };
      changedStyle.transform = "none";
      let reassignedStyle = { transform: "scale(0)", transition: "transform 200ms" };
      reassignedStyle = { transform: "none", transition: "opacity 200ms" };
      export const Examples = () => (
        <>
          <div className="scale-0 transition-transform" style={changedStyle} />
          <div className="scale-0 transition-transform" style={reassignedStyle} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("merges inline individual scale with Tailwind scale transition targets", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div className="transition-all duration-200" style={{ scale: 0 }} />
          <div className="transition-[scale]" style={{ scale: 0 }} />
          <div className="[transition-property:scale] duration-200" style={{ scale: 0 }} />
          <div className="[transition:scale_200ms]" style={{ scale: 0 }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("respects important Tailwind scale and transition declarations over inline styles", () => {
    const result = runRule(
      noScaleFromZero,
      `const A = () => <>
        <div className="!scale-0 !transition-transform !duration-200" style={{ transform: "none", transitionProperty: "opacity" }} />
        <div className="!scale-100 !transition-none !duration-0" style={{ scale: 0, transitionProperty: "scale", transitionDuration: "200ms" }} />
        <div className="!scale-0 !transition-transform !duration-0" style={{ transitionDuration: "200ms" }} />
      </>;`,
      { settings: { "react-doctor": { capabilities: ["tailwind", "tailwind:4"] } } },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when an unresolved inline style may override a scale transition", () => {
    const result = runRule(
      noScaleFromZero,
      `const A = ({ style }) => <div className="scale-0 transition-transform" style={style} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("gates built-in individual scale transitions on Tailwind 4", () => {
    const code = `
      export const Examples = () => (
        <>
          <div className="transition-transform duration-200" style={{ scale: 0 }} />
          <div className="transition duration-200" style={{ scale: 0 }} />
        </>
      );
    `;
    const tailwindThreeResult = runRule(noScaleFromZero, code, {
      filename: "fixture.tsx",
      settings: { "react-doctor": { capabilities: ["tailwind", "tailwind:3.4"] } },
    });
    const tailwindFourResult = runRule(noScaleFromZero, code, {
      filename: "fixture.tsx",
      settings: { "react-doctor": { capabilities: ["tailwind", "tailwind:4"] } },
    });

    expect(tailwindThreeResult.parseErrors).toEqual([]);
    expect(tailwindThreeResult.diagnostics).toEqual([]);
    expect(tailwindFourResult.parseErrors).toEqual([]);
    expect(tailwindFourResult.diagnostics).toHaveLength(2);
  });

  it("matches Tailwind 4 scale utilities to individual scale transitions", () => {
    const code = `const A = () => <>
      <div className="scale-0 transition-[scale] duration-200" />
      <div className="scale-0 [transition:scale_200ms]" />
      <div className="scale-0 transition-[transform] duration-200" />
      <div className="scale-100 transition-[scale] duration-200" />
    </>;`;
    const result = runRule(noScaleFromZero, code, {
      filename: "fixture.tsx",
      settings: { "react-doctor": { capabilities: ["tailwind", "tailwind:4"] } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps explicit individual scale transition targets version-independent", () => {
    const code = `const A = () => <><div className="transition-[scale]" style={{ scale: 0 }} /><div className="[transition:scale_200ms]" style={{ scale: 0 }} /></>;`;
    const result = runRule(noScaleFromZero, code, {
      filename: "fixture.tsx",
      settings: { "react-doctor": { capabilities: ["tailwind", "tailwind:3.4"] } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("uses the last transition shorthand or property declaration", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scale(0)", transition: "transform 200ms", transitionProperty: "opacity" }} />
          <div style={{ transform: "scale(0)", transitionProperty: "transform", transition: "opacity 200ms" }} />
          <div style={{ transform: "scale(0)", transition: "opacity 200ms", transitionProperty: "transform" }} />
          <div style={{ transform: "scale(0)", transitionProperty: "opacity", transition: "transform 200ms" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("uses JavaScript object insertion order when duplicate transition keys overwrite values", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scale(0)", transition: "opacity 200ms", transitionProperty: "transform", transition: "transform 200ms" }} />
          <div style={{ transform: "scale(0)", transitionProperty: "transform", transition: "opacity 200ms", transitionProperty: "transform" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a later style spread may override the transition", () => {
    const result = run(`
      export const Example = ({ style }) => (
        <div style={{ transform: "scale(0)", transition: "transform 200ms", ...style }} />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires a positive transition duration and recognizes an omitted property as all", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scale(0)", transition: "transform 0s" }} />
          <div style={{ transform: "scale(0)", transition: "200ms ease" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("combines transition target and duration longhands", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scale(0)", transition: "transform", transitionDuration: "200ms" }} />
          <div style={{ transform: "scale(0)", transitionProperty: "transform", transitionDuration: "200ms" }} />
          <div style={{ transform: "scale(0)", transitionDuration: "200ms" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("respects zero-duration overrides and shorthand resets", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scale(0)", transition: "transform 200ms", transitionDuration: "0s" }} />
          <div style={{ transform: "scale(0)", transitionProperty: "transform", transitionDuration: "0s" }} />
          <div style={{ transform: "scale(0)", transitionDuration: "200ms", transition: "transform" }} />
          <div style={{ transform: "scale(0)", transitionProperty: "transform" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes zero-valued transform scale functions", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scaleX(0)", transition: "transform 200ms" }} />
          <div style={{ transform: "scaleY(0.0)", transition: "all 200ms" }} />
          <div style={{ transform: "scale(0, 0)", transition: "transform 200ms" }} />
          <div style={{ transform: "scale(0, 1)", transition: "transform 200ms" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("recognizes the CSS individual scale property", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ scale: 0, transition: "scale 200ms" }} />
          <div style={{ scale: "0", transitionProperty: "scale", transitionDuration: "200ms" }} />
          <div style={{ scale: "0 0", transition: "all 200ms" }} />
          <div style={{ scale: 0, transition: "transform 200ms" }} />
          <div style={{ scale: 1, transition: "scale 200ms" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not accept invalid multiple-property transition shorthands", () => {
    const result = run(`
      export const Examples = () => (
        <>
          <div style={{ transform: "scale(0)", transition: "opacity transform 200ms" }} />
          <div style={{ transform: "scale(0)", transition: "all transform 200ms" }} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags scale-zero transitions in static class name branches and const bindings", () => {
    const result = run(`
      const hiddenClassName = "scale-0 transition-transform";
      export const Examples = ({ isOpen }) => (
        <>
          <div className={hiddenClassName} />
          <div className={isOpen ? "scale-100 transition-transform" : "scale-0 transition-transform"} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays silent when a later spread may override a scale-zero class", () => {
    const result = run(`
      export const Example = (props) => (
        <div className="scale-0 transition-transform" {...props} />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

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
