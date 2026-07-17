import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSrcsetWithoutSizes } from "./no-srcset-without-sizes.js";

describe("no-srcset-without-sizes", () => {
  it("reports intrinsic responsive images without sizes", () => {
    const result = runRule(
      noSrcsetWithoutSizes,
      `const Hero = () => <img src="hero.jpg" srcSet="hero-640.jpg 640w, hero-1280.jpg 1280w" alt="" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows responsive images with sizes", () => {
    const result = runRule(
      noSrcsetWithoutSizes,
      `const Hero = () => <img srcSet={candidates} sizes="(min-width: 60rem) 50vw, 100vw" alt="" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows density descriptors and dynamic source sets without sizes", () => {
    const result = runRule(
      noSrcsetWithoutSizes,
      `const Gallery = ({ candidates }) => <><img srcSet="avatar.jpg 1x, avatar@2x.jpg 2x" alt="" /><img srcSet={candidates} alt="" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips plain images, spreads, and custom image components", () => {
    const result = runRule(
      noSrcsetWithoutSizes,
      `const Gallery = ({ props }) => <><img src="plain.jpg" alt="" /><img srcSet="a 1x" {...props} alt="" /><Image srcSet="a 1x" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
