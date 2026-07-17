import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { requireAutoplayVideoPoster } from "./require-autoplay-video-poster.js";

describe("require-autoplay-video-poster", () => {
  it("flags an autoplaying video without a poster", () => {
    const result = runRule(
      requireAutoplayVideoPoster,
      `const Hero = () => <video autoPlay muted playsInline src="/demo.mp4" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows an autoplaying video with a poster", () => {
    const result = runRule(
      requireAutoplayVideoPoster,
      `const Hero = () => <video autoPlay muted playsInline poster="/demo.webp" src="/demo.mp4" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores user-initiated video and spread props", () => {
    const result = runRule(
      requireAutoplayVideoPoster,
      `const Gallery = ({ videoProps }) => <><video controls src="/demo.mp4" /><video autoPlay muted {...videoProps} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
