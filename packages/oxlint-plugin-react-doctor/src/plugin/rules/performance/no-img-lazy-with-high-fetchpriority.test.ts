import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImgLazyWithHighFetchpriority } from "./no-img-lazy-with-high-fetchpriority.js";

describe("no-img-lazy-with-high-fetchpriority", () => {
  it('flags `<img loading="lazy" fetchPriority="high">`', () => {
    const result = runRule(
      noImgLazyWithHighFetchpriority,
      `const Hero = () => <img src="/a.png" loading="lazy" fetchPriority="high" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("contradict");
  });

  it("flags the lowercase HTML `fetchpriority` casing", () => {
    const result = runRule(
      noImgLazyWithHighFetchpriority,
      `const Hero = () => <img src="/a.png" fetchpriority="high" loading="lazy" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it('does not flag `loading="lazy"` with `fetchPriority="low"`', () => {
    const result = runRule(
      noImgLazyWithHighFetchpriority,
      `const X = () => <img src="/a.png" loading="lazy" fetchPriority="low" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag `loading="eager"` with `fetchPriority="high"`', () => {
    const result = runRule(
      noImgLazyWithHighFetchpriority,
      `const X = () => <img src="/a.png" loading="eager" fetchPriority="high" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a lazy image with no fetchPriority", () => {
    const result = runRule(
      noImgLazyWithHighFetchpriority,
      `const X = () => <img src="/a.png" loading="lazy" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a dynamic fetchPriority value", () => {
    const result = runRule(
      noImgLazyWithHighFetchpriority,
      `const X = ({ p }) => <img src="/a.png" loading="lazy" fetchPriority={p} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a capitalized custom `<Image>` component", () => {
    const result = runRule(
      noImgLazyWithHighFetchpriority,
      `const X = () => <Image src="/a.png" loading="lazy" fetchPriority="high" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
