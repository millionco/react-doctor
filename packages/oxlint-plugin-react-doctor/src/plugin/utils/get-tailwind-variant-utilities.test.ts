import { describe, expect, it } from "vite-plus/test";
import { getTailwindVariantUtilities } from "./get-tailwind-variant-utilities.js";

describe("getTailwindVariantUtilities", () => {
  it("collects direct and stacked variants", () => {
    expect(
      getTailwindVariantUtilities(
        "hover:scale-105 motion-safe:hover:shadow-lg focus:scale-100",
        "hover",
      ),
    ).toEqual(["scale-105", "shadow-lg"]);
  });

  it("does not confuse group variants with direct variants", () => {
    expect(getTailwindVariantUtilities("group-hover:scale-105", "hover")).toEqual([]);
  });

  it("ignores colons inside arbitrary variants and values", () => {
    expect(
      getTailwindVariantUtilities(
        "supports-[selector(:focus-visible)]:scale-105 hover:bg-[url(https://example.com/a:b)]",
        "hover",
      ),
    ).toEqual(["bg-[url(https://example.com/a:b)]"]);
  });

  it("preserves whitespace inside arbitrary values", () => {
    expect(
      getTailwindVariantUtilities(
        `hover:content-['hello world'] focus:grid-cols-[minmax(0, 1fr)_auto]`,
        "hover",
      ),
    ).toEqual(["content-['hello world']"]);
  });
});
