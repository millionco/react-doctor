import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noBrokenImageSource } from "./no-broken-image-source.js";

describe("no-broken-image-source", () => {
  it("flags an img without src", () => {
    const result = runRule(noBrokenImageSource, `const Example = () => <img alt="Preview" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags empty and hash placeholder sources", () => {
    const result = runRule(
      noBrokenImageSource,
      `const Example = () => <><img src="" alt="A" /><img src={'#'} alt="B" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag a dynamic source", () => {
    const result = runRule(
      noBrokenImageSource,
      `const Example = ({ source }) => <img src={source} alt="Preview" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume a spread omits src", () => {
    const result = runRule(noBrokenImageSource, `const Example = (props) => <img {...props} />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume a ref leaves src unset", () => {
    const result = runRule(
      noBrokenImageSource,
      `const Example = ({ imageRef }) => <img ref={imageRef} alt="Preview" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not inspect custom Image components", () => {
    const result = runRule(noBrokenImageSource, `const Example = () => <Image alt="Preview" />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag deliberate image mocks in test files", () => {
    const result = runRule(noBrokenImageSource, `const Image = () => <img src="" alt="" />;`, {
      filename: "src/image.spec.tsx",
    });
    expect(result.diagnostics).toHaveLength(0);
  });
});
