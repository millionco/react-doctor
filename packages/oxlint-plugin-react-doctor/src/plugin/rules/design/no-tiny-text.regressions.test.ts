import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTinyText } from "./no-tiny-text.js";

const run = (code: string) => runRule(noTinyText, code, { filename: "fixture.tsx" });

describe("design/no-tiny-text — regressions", () => {
  it("flags uppercase tracked labels when they are functional text", () => {
    const result = run(
      `const C = () => (
        <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Year from
        </label>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps decorative uppercase tracked micro-labels with the specialized rule", () => {
    const result = run(
      `const C = () => (
        <>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Overview</span>
          <span className="text-[10px] uppercase tracking-wide">Activity</span>
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags uppercase styling that is not also tracked", () => {
    const result = run(
      `const C = () => <span style={{ fontSize: 10, textTransform: 'uppercase' }}>Overview</span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags conservative static Tailwind font sizes", () => {
    const result = run(
      `const C = () => (
        <>
          <p className="text-[10px]">First tiny size</p>
          <p className="text-[11px]">Second tiny size</p>
          <p className="text-[9px] text-sm">Readable winner</p>
          <p className="!text-sm text-[8px]">Important readable winner</p>
          <p className="!text-[7px] text-sm">Third tiny size</p>
        </>
      );`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("ignores Tailwind sizes when the project does not have Tailwind", () => {
    const result = runRule(
      noTinyText,
      `const C = () => <p className="text-[9px]">Project CSS owns this token</p>;`,
      {
        filename: "fixture.tsx",
        settings: { "react-doctor": { capabilities: [] } },
      },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags uppercase functional text in interactive and furniture contexts", () => {
    const result = run(
      `const C = () => (
        <>
          <button className="text-[7px] uppercase tracking-wide">Save</button>
          <nav><span className="text-[8px] uppercase tracking-wide">Workspace</span></nav>
          <table><tbody><tr><td className="text-[9px] uppercase tracking-wide">Active</td></tr></tbody></table>
          <span role="tab" className="text-[10px] uppercase tracking-wide">Details</span>
          <span className="meta-row text-[11px] uppercase tracking-wide">2 min ago</span>
        </>
      );`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("stays quiet for statically non-rendered text and hidden ancestors", () => {
    const result = run(
      `const C = () => (
        <>
          <span hidden className="text-[7px]">Hidden attribute</span>
          <span aria-hidden="true" className="text-[8px]">Decorative text</span>
          <span className="hidden text-[9px]">Display none</span>
          <span className="invisible text-[10px]">Invisible</span>
          <span style={{ fontSize: 11, display: "none" }}>Inline display</span>
          <span style={{ fontSize: 6, visibility: "hidden" }}>Inline visibility</span>
          <span hidden="" className="text-[4px]">Empty hidden attribute</span>
          <div hidden><span className="text-[5px]">Hidden by ancestor</span></div>
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for statically visually-hidden text", () => {
    const result = run(
      `const C = () => (
        <>
          <span className="sr-only text-[8px]">Screen reader label</span>
          <span className="visually-hidden text-[9px]">Alternative label</span>
          <div className="screen-reader-only"><span className="text-[10px]">Nested label</span></div>
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("checks visually-hidden text that becomes visible at a breakpoint", () => {
    const result = run(
      `const C = () => <span className="sr-only md:not-sr-only text-[10px]">Responsive label</span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet in code and terminal contexts", () => {
    const result = run(
      `const C = () => (
        <>
          <code className="text-[8px]">const value = 1</code>
          <pre><span className="text-[9px]">npm run build</span></pre>
          <Code><span style={{ fontSize: 7 }}>const ready = true</span></Code>
          <Editor><span style={{ fontSize: 8 }}>index.tsx</span></Editor>
          <Terminal><span style={{ fontSize: 10 }}>build complete</span></Terminal>
          <TerminalRenderer><span style={{ fontSize: 9 }}>server ready</span></TerminalRenderer>
          <div className="console-output"><span style={{ fontSize: 11 }}>server ready</span></div>
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not exempt ordinary components that merely contain a renderer word", () => {
    const result = run(
      `const C = () => (
        <CodeReviewPanel>
          <button style={{ fontSize: 8 }}>Merge</button>
        </CodeReviewPanel>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps unknown class, spread, visibility, and font-size cases quiet", () => {
    const result = run(
      `const C = ({ className, hidden, props, size, visibility }) => (
        <>
          <span className={className} style={{ fontSize: 8 }}>Unknown class effects</span>
          <span {...props} className="text-[9px]">Unknown spread</span>
          <span hidden={hidden} className="text-[10px]">Unknown hidden state</span>
          <span style={{ fontSize: 11, visibility }}>Unknown visibility</span>
          <span style={{ fontSize: size }}>Unknown size</span>
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still checks statically visible false hidden attributes", () => {
    const result = run(
      `const C = () => (
        <>
          <span hidden={false} className="text-[9px]">Visible hidden state</span>
          <span aria-hidden={false} className="text-[10px]">Visible aria state</span>
        </>
      );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag glyph-only content like sort indicators", () => {
    const result = run(
      `const C = ({ asc }: { asc: boolean }) => (
        <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>{asc ? '▲' : '▼'}</span>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags glyphs mixed with unresolved readable content", () => {
    const result = run(`const C = ({ label }) => <span style={{ fontSize: 8 }}>★ {label}</span>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags glyphs mixed with dynamic template text", () => {
    const result = run(
      "const C = ({ label }) => <span style={{ fontSize: 9 }}>{`★ ${label}`}</span>;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a static symbol child", () => {
    const result = run(`const C = () => <span style={{ fontSize: 10 }}>#</span>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a repeated font size once per file", () => {
    const result = run(
      `const C = () => (
        <div>
          <p style={{ fontSize: 11 }}>First hint</p>
          <p style={{ fontSize: 11 }}>Second hint</p>
          <p style={{ fontSize: 11 }}>Third hint</p>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports each distinct tiny font size in a file", () => {
    const result = run(
      `const C = () => (
        <div>
          <p style={{ fontSize: 10 }}>Small</p>
          <p style={{ fontSize: 11 }}>Also small</p>
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still flags tiny body text with dynamic children", () => {
    const result = run(
      `const C = ({ t }: { t: (k: string) => string }) => (
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('settings.help')}</p>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags tiny rem-based text", () => {
    const result = run(`const C = () => <span style={{ fontSize: '0.7rem' }}>Source label</span>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a checkmark HTML entity glyph", () => {
    const result = run(
      `const C = () => <span style={{ fontWeight: 700, fontSize: 7, lineHeight: 1 }}>&#x2713;</span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag children resolving only to an icon binding", () => {
    const result = run(
      `const C = ({ icon, isHovered }) => (
        <button style={{ width: 10, height: 10, fontSize: 7 }}>
          {isHovered ? icon : null}
        </button>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a childless react-icons component sized via fontSize", () => {
    const result = run(
      `const C = () => <FaPlay className="text-white" style={{ fontSize: 8 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an *Icon-named component sized via fontSize", () => {
    const result = run(`const C = () => <ChevronIcon style={{ fontSize: 9 }} />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a numeric-entity DIGIT as real text", () => {
    const result = run(`const C = () => <span style={{ fontSize: 8 }}>&#x31;&#x32;</span>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags tiny text inside a non-icon component with children", () => {
    const result = run(`const C = ({ label }) => <Badge style={{ fontSize: 8 }}>{label}</Badge>;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
