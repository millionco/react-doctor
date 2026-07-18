import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEmDashInJsxText } from "./no-em-dash-in-jsx-text.js";

const run = (code: string, filename = "fixture.tsx") =>
  runRule(noEmDashInJsxText, code, { filename });

describe("react-ui/no-em-dash-in-jsx-text — regressions", () => {
  it("does not flag a standalone em dash used as an empty-value placeholder", () => {
    const result = run(`const C = () => <td>—</td>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an em dash separator between interpolations", () => {
    const result = run(
      `const C = ({ artist, title }: { artist: string; title: string }) => (
        <span>{artist} — {title}</span>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a trailing separator after an interpolation", () => {
    const result = run(`const C = ({ name }: { name: string }) => <div>{name} — </div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag em dashes used as line-leading bullets", () => {
    const result = run(
      `const C = () => (
        <p>
          Fast
          — reliable
          — cheap
        </p>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an em dash embedded in prose", () => {
    const result = run(`const C = () => <p>It's fast — blazingly fast — and simple to use.</p>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still skips prose em dashes inside excluded typography ancestors", () => {
    const result = run(`const C = () => <code>flag — value</code>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not apply UI-copy house style to long-form content files", () => {
    const result = run(
      `const Entry = () => <p>The library supports canvases — including hybrid SVG scenes — across the rendering pipeline.</p>;`,
      "/project/docs/src/blog/entries/interoperability.tsx",
    );
    expect(result.diagnostics).toEqual([]);
  });
});
