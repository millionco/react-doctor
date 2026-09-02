import { describe, expect, it } from "vite-plus/test";
import { isTestlikeFilename, isTestNoiseFilename } from "./is-testlike-filename.js";

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

describe("isTestNoiseFilename", () => {
  it.each([
    "/workspace/src/components/tools/widget.tsx",
    "src/demo/widget.tsx",
    "app/migrations/page.tsx",
    "components/spec/widget.tsx",
    "src/perf/metrics.tsx",
    "C:\\workspace\\src\\components\\tools\\widget.tsx",
  ])("treats an ambiguous directory below a source root as production at %s", (filename) => {
    expect(isTestNoiseFilename(filename)).toBe(false);
  });

  it.each([
    "/workspace/tools/widget.tsx",
    "/workspace/examples/widget.tsx",
    "/workspace/migrations/widget.tsx",
  ])("keeps a root-level non-application directory testlike at %s", (filename) => {
    expect(isTestNoiseFilename(filename)).toBe(true);
  });

  it.each([
    "/workspace/src/__tests__/tools/widget.tsx",
    "/workspace/src/fixtures/demo/widget.tsx",
    "/workspace/src/components/tools/widget.test.tsx",
    "/workspace/src/.storybook/components/widget.tsx",
  ])("keeps an explicit test surface testlike at %s", (filename) => {
    expect(isTestNoiseFilename(filename)).toBe(true);
  });
});
