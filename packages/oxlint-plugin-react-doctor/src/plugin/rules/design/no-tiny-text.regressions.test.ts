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
});
