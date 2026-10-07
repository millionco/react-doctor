import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDecorativePulse } from "./no-decorative-pulse.js";

describe("no-decorative-pulse", () => {
  it("flags pulsing stable copy", () => {
    const result = runRule(
      noDecorativePulse,
      `const Hero = () => <span className="animate-pulse text-purple-500">New feature</span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows loading and live status feedback", () => {
    const result = runRule(
      noDecorativePulse,
      `const Loading = () => <><div aria-busy="true" className="animate-pulse">Loading account</div><span role="status" className="animate-pulse">Syncing</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an empty status dot", () => {
    const result = runRule(
      noDecorativePulse,
      `const Status = () => <span aria-label="Online" className="size-2 rounded-full bg-green-500 animate-pulse" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat unrelated roles or aria-busy false as loading state", () => {
    const result = runRule(
      noDecorativePulse,
      `const Hero = () => <><button role="button" className="animate-pulse">New feature</button><span aria-busy="false" className="animate-pulse">New feature</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("respects effective Tailwind animation overrides for stable copy", () => {
    const result = runRule(
      noDecorativePulse,
      `const Hero = () => <>
        <span className="animate-pulse animate-none">New feature</span>
        <span className="animate-pulse !animate-none">New feature</span>
        <span className="animate-none !animate-pulse">New feature</span>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags static cursor glyphs with proven infinite blink animations in hero copy", () => {
    const result = runRule(
      noDecorativePulse,
      `
        const Hero = ({ dynamicStyle }) => (
          <section>
            <h1>Ship faster</h1>
            <span className="animate-pulse">▌</span>
            <span className="animate-[caret-blink_1s_steps(1)_infinite]">_</span>
            <span className="[animation:cursor_800ms_steps(1)_infinite]">{'|'}</span>
            <span className="!animate-pulse animate-none">|</span>
            <span style={{ animation: "blink 1s steps(1) infinite" }}>{\`■\`}</span>
            <span style={{ animationName: "cursor-blink", animationIterationCount: "infinite" }}>❚</span>
            <span className="animate-pulse" style={dynamicStyle}>_</span>
            <span className="animate-pulse" style={{ animationName: "cursor" }}>|</span>
            <span className="animate-pulse"><em>_</em></span>
          </section>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(9);
    expect(
      result.diagnostics.every((diagnostic) => diagnostic.message.includes("fake cursor")),
    ).toBe(true);
  });

  it("requires a hero or marketing display context for cursor diagnostics", () => {
    const result = runRule(
      noDecorativePulse,
      `
        const CursorExamples = () => (
          <>
            <p><span className="animate-pulse">_</span></p>
            <aside><span style={{ animation: "blink 1s infinite" }}>▌</span></aside>
            <footer className="product-footer">
              <span className="animate-[cursor_1s_infinite]">|</span>
            </footer>
          </>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows cursors in editable, live, progress, code, and terminal contexts", () => {
    const result = runRule(
      noDecorativePulse,
      `
        const Hero = ({ busy }) => (
          <section className="hero">
            <div contentEditable><span className="animate-pulse">_</span></div>
            <div role="textbox"><span className="animate-pulse">|</span></div>
            <div role="status"><span className="animate-pulse">▌</span></div>
            <div role="progressbar"><span className="animate-pulse">■</span></div>
            <div aria-live="polite"><span className="animate-pulse">❚</span></div>
            <span aria-busy className="animate-pulse">_</span>
            <div aria-busy="true"><span className="animate-pulse">|</span></div>
            <div aria-busy={busy}><span className="animate-pulse">▌</span></div>
            <pre><span className="animate-pulse">_</span></pre>
            <code><span className="animate-pulse">|</span></code>
            <Terminal><span className="animate-pulse">▌</span></Terminal>
            <div className="syntax-editor"><span className="animate-pulse">■</span></div>
          </section>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows finite, dynamic, unrelated, and ambiguous cursor animations", () => {
    const result = runRule(
      noDecorativePulse,
      `
        const Hero = ({ animation, className, role, props }) => (
          <section className="hero">
            <span className="animate-[blink_1s_3]">_</span>
            <span className="animate-spin">|</span>
            <span className="animate-pulse !animate-none">_</span>
            <span className="animate-pulse animate-none">|</span>
            <span className="animate-[cursor_1s_infinite] animate-none">▌</span>
            <span className={className}>▌</span>
            <span style={{ animation }}>■</span>
            <span style={{ animation: "blink 1s 2, spin 1s infinite" }}>❚</span>
            <span style={{ animationName: "blink", animationIterationCount: "3" }}>_</span>
            <span style={{ animationName: "cursor" }}>|</span>
            <span role={role} className="animate-pulse">▌</span>
            <span {...props} className="animate-pulse">■</span>
            <span className="animate-pulse">{animation}_</span>
          </section>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows aria-busy false to remain eligible for a cursor finding", () => {
    const result = runRule(
      noDecorativePulse,
      `const Hero = () => <section className="hero"><span aria-busy={false} className="animate-pulse">_</span></section>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps cursor diagnostics out of documentation files", () => {
    const result = runRule(
      noDecorativePulse,
      `const DocsHero = () => <section className="hero"><span className="animate-pulse">_</span></section>;`,
      { filename: "/project/docs/hero.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
