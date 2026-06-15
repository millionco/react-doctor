import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { imgMissingDimensions } from "./img-missing-dimensions.js";

describe("img-missing-dimensions", () => {
  it("flags a naked `<img src>` with no dimensions or CSS", () => {
    const result = runRule(
      imgMissingDimensions,
      `const A = () => <img src="/logo.png" alt="Logo" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("layout shift");
  });

  it("does not flag an `<img>` with width and height", () => {
    const result = runRule(
      imgMissingDimensions,
      `const A = () => <img src="/logo.png" width={120} height={40} alt="Logo" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an `<img>` with only width (deliberate sizing)", () => {
    const result = runRule(
      imgMissingDimensions,
      `const A = () => <img src="/logo.png" width="120" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an `<img>` sized via className", () => {
    const result = runRule(
      imgMissingDimensions,
      `const A = () => <img src="/logo.png" className="h-10 w-10" alt="Logo" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an `<img>` sized via inline style", () => {
    const result = runRule(
      imgMissingDimensions,
      `const A = () => <img src="/logo.png" style={{ aspectRatio: "16/9" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a responsive `<img>` with srcSet/sizes", () => {
    const result = runRule(
      imgMissingDimensions,
      `const A = () => <img src="/a.png" srcSet="/a.png 1x, /a@2x.png 2x" sizes="100vw" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an `<img>` with a spread that could supply sizing", () => {
    const result = runRule(
      imgMissingDimensions,
      `const A = (p) => <img src="/logo.png" {...p} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an `<img>` with no src", () => {
    const result = runRule(imgMissingDimensions, `const A = () => <img alt="" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a capitalized custom `<Img>` component", () => {
    const result = runRule(imgMissingDimensions, `const A = () => <Img src="/logo.png" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
