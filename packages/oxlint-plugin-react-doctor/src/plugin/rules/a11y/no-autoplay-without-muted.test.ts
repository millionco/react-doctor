import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAutoplayWithoutMuted } from "./no-autoplay-without-muted.js";

describe("no-autoplay-without-muted", () => {
  it("flags `<video autoPlay>` without muted", () => {
    const code = `const A = () => <video autoPlay loop src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `<audio autoPlay>` without muted", () => {
    const code = `const A = () => <audio autoPlay src="clip.mp3" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `autoPlay` with `muted={false}`", () => {
    const code = `const A = () => <video autoPlay muted={false} src="x.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags quoted `autoPlay="false"` without muted', () => {
    const code = `const A = () => <video autoPlay="false" src="x.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag `<video autoPlay muted>`", () => {
    const code = `const A = () => <video autoPlay muted loop playsInline src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `<video autoPlay muted={true}>`", () => {
    const code = `const A = () => <video autoPlay muted={true} src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does NOT flag quoted `muted="false"` because the attribute is enabled', () => {
    const code = `const A = () => <video autoPlay muted="false" src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a `<video>` with no autoPlay", () => {
    const code = `const A = () => <video controls src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `autoPlay={false}`", () => {
    const code = `const A = () => <video autoPlay={false} src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when a spread could supply muted", () => {
    const code = `const A = (props) => <video autoPlay {...props} src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag dynamic `autoPlay={shouldPlay}`", () => {
    const code = `const A = ({ shouldPlay }) => <video autoPlay={shouldPlay} src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a custom `<Video autoPlay>` component", () => {
    const code = `const A = () => <Video autoPlay src="hero.mp4" />;`;
    const result = runRule(noAutoplayWithoutMuted, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
