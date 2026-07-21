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

  it("flags an autoplaying video with a source child and no poster", () => {
    const result = runRule(
      requireAutoplayVideoPoster,
      `const Hero = () => <video autoPlay muted><source src="/demo.mp4" type="video/mp4" /></video>;`,
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

  it("treats an empty poster as missing and a static true string as autoplay", () => {
    const result = runRule(
      requireAutoplayVideoPoster,
      `const Hero = () => <><video autoPlay src="/one.mp4" poster="" /><video autoPlay={"true"} src="/two.mp4" /><video autoPlay={false} src="/three.mp4" /><video autoPlay src="/four.mp4" poster="/four.webp" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores user-initiated video and spread props", () => {
    const result = runRule(
      requireAutoplayVideoPoster,
      `const Gallery = ({ videoProps }) => <><video controls src="/demo.mp4" /><video autoPlay muted {...videoProps} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores autoplay video elements populated imperatively with a MediaStream", () => {
    const result = runRule(
      requireAutoplayVideoPoster,
      `const Call = ({ videoRef }) => <video ref={videoRef} autoPlay muted playsInline />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
