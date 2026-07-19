import { describe, expect, it } from "vite-plus/test";
import { getStaticTailwindFontSize } from "./get-static-tailwind-font-size.js";

describe("getStaticTailwindFontSize", () => {
  it("resolves the last base Tailwind text size", () => {
    expect(getStaticTailwindFontSize("text-sm text-3xl")).toBe(30);
  });

  it("resolves arbitrary pixel and rem sizes", () => {
    expect(getStaticTailwindFontSize("text-[24px]")).toBe(24);
    expect(getStaticTailwindFontSize("text-[2rem]")).toBe(32);
  });

  it("ignores variant-only sizes", () => {
    expect(getStaticTailwindFontSize("md:text-3xl")).toBeNull();
  });
});
