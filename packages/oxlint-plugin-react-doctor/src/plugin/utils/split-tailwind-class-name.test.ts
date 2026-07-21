import { describe, expect, it } from "vite-plus/test";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";

describe("splitTailwindClassName", () => {
  it("splits whitespace-delimited utilities", () => {
    expect(splitTailwindClassName("  flex\n items-center\tgap-2  ")).toEqual([
      "flex",
      "items-center",
      "gap-2",
    ]);
  });

  it("preserves whitespace inside balanced arbitrary syntax and quotes", () => {
    expect(
      splitTailwindClassName(
        `content-['hello world'] grid-cols-[minmax(0, 1fr)_auto] bg-[url("hero image.svg")]`,
      ),
    ).toEqual([
      "content-['hello world']",
      "grid-cols-[minmax(0, 1fr)_auto]",
      'bg-[url("hero image.svg")]',
    ]);
  });

  it("preserves escaped whitespace and resumes after escaped backslashes", () => {
    expect(splitTailwindClassName(String.raw`content-[hello\ world] flex\\ gap-2`)).toEqual([
      String.raw`content-[hello\ world]`,
      String.raw`flex\\`,
      "gap-2",
    ]);
  });
});
