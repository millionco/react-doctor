import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxFilenameExtension } from "./jsx-filename-extension.js";

// Issue #539: a missing filename must not crash filename-based rules.
// `jsx-filename-extension` reads `context.filename` up front, so it has to
// coalesce instead of feeding `undefined` into `normalizeFilename`.
describe("react-builtins/jsx-filename-extension — regressions", () => {
  it("does not crash when the filename is unavailable (#539)", () => {
    expect(() =>
      runRule(jsxFilenameExtension, "export const App = () => <div />;", { filename: undefined }),
    ).not.toThrow();
  });
});
