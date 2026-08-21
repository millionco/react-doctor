import { describe, expect, it } from "vite-plus/test";
import { isTestlikeFilename } from "./is-testlike-filename.js";

describe("isTestlikeFilename", () => {
  it.each(["/workspace/test-stubs/trycompai-ui.tsx", "/workspace/src/test-stubs/trycompai-ui.tsx"])(
    "recognizes test-only dependency stubs at %s",
    (filename) => {
      expect(isTestlikeFilename(filename)).toBe(true);
    },
  );

  it("does not classify a production stub component as test-only", () => {
    expect(isTestlikeFilename("/workspace/src/components/dialog-stub.tsx")).toBe(false);
  });
});
