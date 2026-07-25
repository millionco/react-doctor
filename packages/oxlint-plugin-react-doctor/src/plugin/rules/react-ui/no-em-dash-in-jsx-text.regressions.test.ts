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

  it.each([
    "The setup is fast &mdash; even on large projects.",
    "The setup is fast &#8212; even on large projects.",
    "The setup is fast &#0008212; even on large projects.",
    "The setup is fast &#x2014; even on large projects.",
    "The setup is fast &#X02014; even on large projects.",
  ])("flags em dash entities embedded in prose: %s", (text) => {
    const result = run(`const C = () => <p>${text}</p>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "The setup is fast &ndash; even on large projects.",
    "The setup is fast &#8211; even on large projects.",
    "The setup is fast &#x2013; even on large projects.",
  ])("does not flag en dash entities: %s", (text) => {
    const result = run(`const C = () => <p>${text}</p>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag em dash entities used as placeholders or interpolation separators", () => {
    const result = run(
      `const C = ({ artist, title }: { artist: string; title: string }) => (
        <><span>&mdash;</span><span>{artist} &#8212; {title}</span></>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag short metadata separators", () => {
    const result = run(
      `const C = () => (
        <>
          <span>Radiohead — Creep</span>
          <span>Radiohead &mdash; Creep</span>
          <span>{"Radiohead — Creep"}</span>
          <span>{\`Radiohead — Creep\`}</span>
        </>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires five same-line letter words for prose evidence", () => {
    const quietResult = run(`const C = () => <p>Radiohead live recording — Creep</p>;`);
    const reportedResult = run(
      `const C = () => <p>Radiohead live recording — Creep performance</p>;`,
    );
    expect(quietResult.diagnostics).toEqual([]);
    expect(reportedResult.diagnostics).toHaveLength(1);
  });

  it("does not combine words from other lines with a short metadata separator", () => {
    const result = run(
      `const C = () => (
        <p>
          Previously released
          Radiohead — Creep
          Recorded live tonight
        </p>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags em dashes in static JSX expression strings", () => {
    const result = run(`const C = () => <p>{"The setup is fast — even on large projects."}</p>;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags em dashes in wrapped static conditional branches", () => {
    const result = run(
      `const C = ({ enabled }: { enabled: boolean }) => (
        <p>{(enabled ? "The setup is fast — even on large projects." : "Disabled") as string}</p>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("leaves unresolved expression values quiet", () => {
    const result = run(
      `const copy = "The setup is fast — even on large projects.";
       const C = () => <p>{copy}</p>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags em dashes in static template quasis", () => {
    const result = run(
      "const C = ({ count }: { count: number }) => <p>{`The setup is fast — even for ${count} projects.`}</p>;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a template em dash separator between interpolations", () => {
    const result = run(
      "const C = ({ artist, title }: { artist: string; title: string }) => <p>{`${artist} — ${title}`}</p>;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not decode entity-looking text inside JavaScript strings", () => {
    const result = run(
      `const C = () => <p>{"The setup is fast &mdash; even on large projects."}</p>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag statically hidden JSX text or expressions", () => {
    const result = run(
      `const C = () => (
        <>
          <p hidden>The setup is fast — even on large projects.</p>
          <p aria-hidden>The setup is fast — even on large projects.</p>
          <p aria-hidden={true}>{"The setup is fast — even on large projects."}</p>
          <p style={{ display: "none" }}>The setup is fast — even on large projects.</p>
          <p style={{ visibility: "hidden" }}>{"The setup is fast — even on large projects."}</p>
          <p className="hidden">The setup is fast — even on large projects.</p>
          <p className="[visibility:hidden]">{"The setup is fast — even on large projects."}</p>
        </>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag text inside a statically hidden ancestor", () => {
    const result = run(
      `const C = () => (
        <>
          <section hidden><p>The setup is fast — even on large projects.</p></section>
          <section aria-hidden={true}>
            <p>{"The setup is fast — even on large projects."}</p>
          </section>
          <section style={{ display: "none" }}>
            <p>The setup is fast — even on large projects.</p>
          </section>
          <section className="invisible">
            <p>{"The setup is fast — even on large projects."}</p>
          </section>
        </>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still checks text with dynamic or breakpoint-visible rendering", () => {
    const result = run(
      `const C = ({ isHidden }: { isHidden: boolean }) => (
        <>
          <p hidden={isHidden}>The setup is fast — even on large projects.</p>
          <p className="hidden md:block">The setup is fast — even on large projects.</p>
        </>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag standalone or bullet em dashes in static expressions", () => {
    const result = run(
      "const C = () => <><span>{'—'}</span><p>{`Fast\\n— reliable\\n— cheap`}</p></>;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still skips prose em dashes inside excluded typography ancestors", () => {
    const result = run(`const C = () => <code>flag — value{"fast — reliable"}</code>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not apply UI-copy house style to long-form content files", () => {
    const result = run(
      `const Entry = () => <p>The library supports canvases — including hybrid SVG scenes — across the rendering pipeline.</p>;`,
      "/project/docs/src/blog/entries/interoperability.tsx",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not apply UI-copy house style to static expressions in long-form content files", () => {
    const result = run(
      `const Entry = () => <p>{"The library supports canvases — including hybrid SVG scenes."}</p>;`,
      "/project/docs/src/blog/entries/interoperability.tsx",
    );
    expect(result.diagnostics).toEqual([]);
  });
});
