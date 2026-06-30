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
});
