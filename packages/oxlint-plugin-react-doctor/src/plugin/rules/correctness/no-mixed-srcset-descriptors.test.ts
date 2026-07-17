import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMixedSrcsetDescriptors } from "./no-mixed-srcset-descriptors.js";

describe("no-mixed-srcset-descriptors", () => {
  it("reports width mixed with density or descriptorless candidates", () => {
    const result = runRule(
      noMixedSrcsetDescriptors,
      `const Gallery = () => <><img srcSet="small.jpg 640w, large.jpg 2x" /><img srcSet="small.jpg 640w, large.jpg" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows consistent width and density descriptor sets", () => {
    const result = runRule(
      noMixedSrcsetDescriptors,
      `const Gallery = () => <><img srcSet="small.jpg 640w, large.jpg 1280w" /><img srcSet="small.jpg 1x, large.jpg 2x" /><img srcSet="small.jpg, large.jpg 2x" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic, data URL, spread-owned, and custom source sets", () => {
    const result = runRule(
      noMixedSrcsetDescriptors,
      `const Gallery = ({ srcSet, props }) => <><img srcSet={srcSet} /><img srcSet="data:image/png;base64,AAAA 1x, image.png 640w" /><img srcSet="a 1x, b 640w" {...props} /><Image srcSet="a 1x, b 640w" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
