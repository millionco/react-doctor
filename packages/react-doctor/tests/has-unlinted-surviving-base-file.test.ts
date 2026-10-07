import { describe, expect, it } from "vite-plus/test";
import { hasUnlintedSurvivingBaseFile } from "../src/cli/utils/has-unlinted-surviving-base-file.js";

describe("hasUnlintedSurvivingBaseFile", () => {
  const baseLintPaths = ["src/deleted.tsx", "src/modified.tsx"];
  const headFiles = new Set(["src/modified.tsx", "src/added.tsx"]);

  it("ignores a skipped base file that was deleted at head", () => {
    expect(
      hasUnlintedSurvivingBaseFile({
        baseLintPaths,
        headFiles,
        analyzedBaseFiles: ["src/modified.tsx"],
      }),
    ).toBe(false);
  });

  it("flags a skipped base file that still exists at head", () => {
    expect(
      hasUnlintedSurvivingBaseFile({
        baseLintPaths,
        headFiles,
        analyzedBaseFiles: ["src/deleted.tsx"],
      }),
    ).toBe(true);
  });

  it("flags a skipped base file that survives under a new name", () => {
    const input = {
      baseLintPaths: ["src/old.tsx"],
      headFiles: new Set(["src/new.tsx"]),
      renamedFiles: { "src/old.tsx": "src/new.tsx" },
    };
    expect(hasUnlintedSurvivingBaseFile({ ...input, analyzedBaseFiles: [] })).toBe(true);
    expect(hasUnlintedSurvivingBaseFile({ ...input, analyzedBaseFiles: ["src/old.tsx"] })).toBe(
      false,
    );
  });

  it("normalizes Windows separators before matching", () => {
    expect(
      hasUnlintedSurvivingBaseFile({
        baseLintPaths: ["src\\modified.tsx"],
        headFiles,
        analyzedBaseFiles: ["src\\modified.tsx"],
      }),
    ).toBe(false);
  });

  it("ignores non-source base paths", () => {
    expect(
      hasUnlintedSurvivingBaseFile({
        baseLintPaths: ["src/locale.json"],
        headFiles: new Set(["src/locale.json"]),
        analyzedBaseFiles: [],
      }),
    ).toBe(false);
  });
});
