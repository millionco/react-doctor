import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTinyText } from "./no-tiny-text.js";

const run = (code: string) => runRule(noTinyText, code, { filename: "fixture.tsx" });

describe("design/no-tiny-text — regressions", () => {
  it("does not flag uppercase tracked micro-labels", () => {
    const result = run(
      `const C = () => (
        <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Year from
        </label>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag glyph-only content like sort indicators", () => {
    const result = run(
      `const C = ({ asc }: { asc: boolean }) => (
        <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>{asc ? '▲' : '▼'}</span>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
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
