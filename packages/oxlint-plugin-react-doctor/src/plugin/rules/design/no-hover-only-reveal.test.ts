import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noHoverOnlyReveal } from "./no-hover-only-reveal.js";

describe("no-hover-only-reveal", () => {
  it("reports direct and grouped hover-only reveals", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <><button className="opacity-0 hover:opacity-100" /><button className="invisible group-hover:visible" /><div className="hidden group-hover:flex">Menu</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows matching keyboard reveals", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <><button className="opacity-0 hover:opacity-100 focus-visible:opacity-100" /><button className="invisible group-hover:visible group-focus-within:visible" /><div className="hidden group-hover:flex group-focus:flex" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires direct focus reveals to be keyboard reachable", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <>
        <div className="hidden hover:block focus:block">Menu</div>
        <div tabIndex={0} className="opacity-0 hover:opacity-100 focus:opacity-100">Menu</div>
        <Button className="opacity-0 hover:opacity-100 focus:opacity-100">Menu</Button>
        <Trigger className="opacity-0 hover:opacity-100 focus:opacity-100">Menu</Trigger>
        <Button className="hidden hover:block focus:block">Menu</Button>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("matches named group and outer variant scopes", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <>
        <span className="opacity-0 group-hover/item:opacity-100">Edit</span>
        <span className="opacity-0 group-hover/item:opacity-100 group-focus-within/other:opacity-100">Delete</span>
        <span className="dark:opacity-0 dark:group-hover/item:opacity-100 light:group-focus-within/item:opacity-100">Archive</span>
        <span className="opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100">Share</span>
        <button className="dark:opacity-0 dark:hover:opacity-100 focus-visible:opacity-100">Open</button>
        <button className="lg:opacity-0 lg:hover:opacity-100 md:focus-visible:opacity-100">Move</button>
        <button className="max-md:opacity-0 max-md:hover:opacity-100 max-lg:focus-visible:opacity-100">Copy</button>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("reports Motion opacity revealed only on hover", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `import { motion } from "motion/react";
       const Actions = () => <>
         <motion.button initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} />
         <motion.div animate={{ opacity: 0 }} whileHover={{ opacity: 0.8 }}>Details</motion.div>
       </>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows Motion focus reveals and skips dynamic or unrelated components", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `import { motion } from "motion/react";
       const Fake = { button: "button" };
       const Actions = ({ initial }) => <>
         <motion.button initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} whileFocus={{ opacity: 1 }} />
         <motion.button initial={initial} whileHover={{ opacity: 1 }} />
         <motion.button initial={{ opacity: 0 }} animate={initial} whileHover={{ opacity: 1 }}>Edit</motion.button>
         <Fake.button initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} />
       </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the animate opacity as the Motion resting state", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `import { motion } from "motion/react";
       const Actions = () => <>
         <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileHover={{ opacity: 1 }}>Edit</motion.button>
         <motion.button initial={{ opacity: 1 }} animate={{ opacity: 0 }} whileHover={{ opacity: 1 }}>Delete</motion.button>
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips empty hover effects but still checks aria-hidden visual content", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `import { motion } from "motion/react";
       const Decorations = () => <>
         <div className="opacity-0 group-hover:opacity-100" />
         <div className="opacity-0 group-hover:opacity-100"></div>
         <div aria-hidden="true" className="opacity-0 group-hover:opacity-100">Glow</div>
         <motion.div initial={{ opacity: 0 }} whileHover={{ opacity: 1 }} />
         <motion.div aria-hidden initial={{ opacity: 0 }} whileHover={{ opacity: 1 }}>Glow</motion.div>
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still reports empty interactive controls revealed only on hover", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <><button aria-label="Edit" className="opacity-0 group-hover:opacity-100" /><Button aria-label="Delete" className="opacity-0 group-hover:opacity-100" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("respects important resting-state precedence regardless of class order", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <>
        <button className="!opacity-100 opacity-0 hover:opacity-100">Visible</button>
        <button className="opacity-0 !opacity-100 hover:opacity-100">Visible</button>
        <button className="!opacity-0 opacity-100 hover:!opacity-100">Hidden</button>
        <button className="opacity-100 !opacity-0 hover:!opacity-100">Hidden</button>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("respects important hover and keyboard reveal precedence regardless of class order", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <>
        <button className="opacity-0 hover:!opacity-0 hover:opacity-100">Hidden</button>
        <button className="opacity-0 hover:opacity-100 hover:!opacity-0">Hidden</button>
        <button className="opacity-0 hover:!opacity-100 hover:opacity-0">Hover only</button>
        <button className="opacity-0 hover:opacity-0 hover:!opacity-100">Hover only</button>
        <button className="opacity-0 hover:opacity-100 focus:!opacity-0 focus:opacity-100">No keyboard reveal</button>
        <button className="opacity-0 hover:opacity-100 focus:opacity-100 focus:!opacity-0">No keyboard reveal</button>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("skips conflicting equal-priority visibility setters", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <>
        <button className="opacity-0 opacity-100 hover:opacity-100">Resting conflict</button>
        <button className="opacity-100 opacity-0 hover:opacity-100">Resting conflict</button>
        <button className="opacity-0 hover:opacity-0 hover:opacity-100">Hover conflict</button>
        <button className="opacity-0 hover:opacity-100 hover:opacity-0">Hover conflict</button>
        <button className="opacity-0 hover:opacity-100 focus:opacity-0 focus:opacity-100">Keyboard conflict</button>
        <button className="!opacity-0 hover:!opacity-0 hover:!opacity-100">Important conflict</button>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("evaluates broad keyboard reveals at the full hover scope", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <>
        <button className="dark:opacity-0 dark:hover:opacity-100 focus:opacity-100 dark:focus:opacity-0">
          Edit
        </button>
        <button className="dark:opacity-0 dark:hover:opacity-100 focus:opacity-100 dark:focus:opacity-100">
          Delete
        </button>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves balanced arbitrary values while tokenizing classes", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Action = () => <button className="before:content-['Edit action'] opacity-0 hover:opacity-100">Edit</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("proves only numeric arbitrary opacity states", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = () => <>
        <button className="opacity-[0] hover:opacity-[1]">Edit</button>
        <button className="opacity-[0.0] hover:opacity-[25%]">Delete</button>
        <button className="opacity-[var(--rest)] hover:opacity-[1]">Archive</button>
        <button className="opacity-[0] hover:opacity-[var(--hover)]">Share</button>
        <button className="opacity-[0] hover:opacity-[calc(var(--opacity))]">Copy</button>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips visible rest states, dynamic classes, and spreads", () => {
    const result = runRule(
      noHoverOnlyReveal,
      `const Actions = ({ className, props }) => <><button className="hover:opacity-100" /><button className={className} /><button className="opacity-0 hover:opacity-100" {...props} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
