import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mediaHasCaption } from "./media-has-caption.js";

describe("a11y/media-has-caption regressions", () => {
  it("exempts a `<video>` whose tracks are rendered via `.map(...)`", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = ({ tracks }) => <video src="movie.mp4">{tracks.map((t) => <track key={t.l} kind="captions" src={t.s} />)}</video>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts a `<video>` whose track is conditionally rendered", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src="movie.mp4">{hasTrack && <track kind="captions" />}</video>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `<video>` with no track at all", () => {
    const result = runRule(mediaHasCaption, `const V = () => <video src="movie.mp4" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a `<video>` with a static non-captions track", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src="movie.mp4"><track kind="subtitles" /></video>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it('accepts a captions `<track kind={"captions"}>` (literal in an expression container)', () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src="movie.mp4"><track kind={"captions"} src="c.vtt" /></video>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `<video>` whose track `kind` is a dynamic expression", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src="movie.mp4"><track kind={dynamic} /></video>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // Bugbot wave 4: a dynamic `.map` with a dynamic `kind` could resolve to
  // captions at runtime, so it stays exempt (avoids a false positive)…
  it("exempts a `.map(...)` track source whose kind is dynamic", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = ({ tracks }) => <video src="movie.mp4">{tracks.map((t) => <track key={t.l} kind={t.kind} src={t.s} />)}</video>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // …but a dynamic source that only ever renders a provably non-caption track
  // (static `kind="subtitles"`) does NOT satisfy the captions requirement.
  it("still flags a dynamic track source that only renders a static non-captions track", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = ({ tracks }) => <video src="movie.mp4">{tracks.map((t) => <track key={t.l} kind="subtitles" src={t.s} />)}</video>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a conditional track source that only renders a static non-captions track", () => {
    const result = runRule(
      mediaHasCaption,
      `const V = () => <video src="movie.mp4">{hasTrack && <track kind="descriptions" />}</video>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // Docs-validation FP cluster: runtime-only media sources (blob object
  // URLs, user attachments, generated media paths) have no static asset a
  // captions file could be authored for, so the documented fix is
  // inapplicable and the rule stays silent.
  it("exempts an `<audio>` whose src is a runtime identifier (blob object URL)", () => {
    const result = runRule(
      mediaHasCaption,
      `const A = ({ objectUrl }) => <audio controls src={objectUrl} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts a `<video>` whose src is a dynamic template literal", () => {
    const result = runRule(
      mediaHasCaption,
      "const V = ({ jobId }) => <video src={`/data/videos/${jobId}.mp4`} controls />;",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts an `<audio>` whose only `<source>` src is dynamic", () => {
    const result = runRule(
      mediaHasCaption,
      `const A = ({ mediaUrl }) => <audio controls><source src={mediaUrl} /></audio>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts an `<audio>` whose src is a runtime fallback expression", () => {
    const result = runRule(
      mediaHasCaption,
      "const A = ({ att }) => <audio controls src={att.url || `data:${att.mimeType};base64,${att.data}`} />;",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `<video>` with a static string src", () => {
    const result = runRule(mediaHasCaption, `const V = () => <video src="movie.mp4" controls />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a `<video>` with a static template-literal src", () => {
    const result = runRule(
      mediaHasCaption,
      "const V = () => <video src={`/assets/intro.mp4`} controls />;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a `<video>` with no src at all", () => {
    const result = runRule(mediaHasCaption, `const V = () => <video controls />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an `<audio>` with a static `<source>` and a dynamic own src absent", () => {
    const result = runRule(
      mediaHasCaption,
      `const A = () => <audio controls><source src="talk.mp3" /></audio>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
