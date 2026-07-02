import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mediaHasCaption } from "./media-has-caption.js";

describe("a11y/media-has-caption regressions", () => {
  it("exempts a `<video>` whose tracks are rendered via `.map(...)`", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = ({ tracks }) => <video src={s}>{tracks.map((t) => <track key={t.l} kind="captions" src={t.s} />)}</video>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts a `<video>` whose track is conditionally rendered", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src={s}>{hasTrack && <track kind="captions" />}</video>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `<video>` with no track at all", () => {
    const result = runRule(mediaHasCaption, `const V = () => <video src={s} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a `<video>` with a static non-captions track", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src={s}><track kind="subtitles" /></video>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it('accepts a captions `<track kind={"captions"}>` (literal in an expression container)', () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src={s}><track kind={"captions"} src="c.vtt" /></video>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `<video>` whose track `kind` is a dynamic expression", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src={s}><track kind={dynamic} /></video>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // Bugbot wave 4: a dynamic `.map` with a dynamic `kind` could resolve to
  // captions at runtime, so it stays exempt (avoids a false positive)…
  it("exempts a `.map(...)` track source whose kind is dynamic", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = ({ tracks }) => <video src={s}>{tracks.map((t) => <track key={t.l} kind={t.kind} src={t.s} />)}</video>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // …but a dynamic source that only ever renders a provably non-caption track
  // (static `kind="subtitles"`) does NOT satisfy the captions requirement.
  it("still flags a dynamic track source that only renders a static non-captions track", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = ({ tracks }) => <video src={s}>{tracks.map((t) => <track key={t.l} kind="subtitles" src={t.s} />)}</video>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a conditional track source that only renders a static non-captions track", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src={s}>{hasTrack && <track kind="descriptions" />}</video>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
