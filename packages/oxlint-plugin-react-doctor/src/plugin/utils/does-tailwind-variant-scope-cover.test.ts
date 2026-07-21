import { describe, expect, it } from "vite-plus/test";
import { doesTailwindVariantScopeCover } from "./does-tailwind-variant-scope-cover.js";

describe("doesTailwindVariantScopeCover", () => {
  it("allows broader ordered scopes and exact scopes", () => {
    expect(doesTailwindVariantScopeCover([], ["dark", "md", "hover"])).toBe(true);
    expect(doesTailwindVariantScopeCover(["dark", "md"], ["dark", "md", "hover"])).toBe(true);
    expect(doesTailwindVariantScopeCover(["md"], ["md"])).toBe(true);
  });

  it("does not infer breakpoint ordering or reorder variant stacks", () => {
    expect(doesTailwindVariantScopeCover(["md"], ["lg"])).toBe(false);
    expect(doesTailwindVariantScopeCover(["max-lg"], ["max-md"])).toBe(false);
    expect(doesTailwindVariantScopeCover(["md", "dark"], ["dark", "md", "hover"])).toBe(false);
  });
});
