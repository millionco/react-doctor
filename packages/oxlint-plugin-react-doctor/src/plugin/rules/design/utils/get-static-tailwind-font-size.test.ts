import { describe, expect, it } from "vite-plus/test";
import { getStaticTailwindFontSize } from "./get-static-tailwind-font-size.js";

describe("getStaticTailwindFontSize", () => {
  it("returns null for conflicting base Tailwind text sizes", () => {
    expect(getStaticTailwindFontSize("text-sm text-3xl")).toBeNull();
    expect(getStaticTailwindFontSize("!text-sm text-3xl!")).toBeNull();
  });

  it("does not treat duplicate sizes as conflicts", () => {
    expect(getStaticTailwindFontSize("text-sm text-sm")).toBe(14);
  });

  it("resolves arbitrary pixel and rem sizes", () => {
    expect(getStaticTailwindFontSize("text-[24px]")).toBe(24);
    expect(getStaticTailwindFontSize("text-[2rem]")).toBe(32);
  });

  it("ignores variant-only sizes", () => {
    expect(getStaticTailwindFontSize("md:text-3xl")).toBeNull();
  });

  it("ignores malformed arbitrary values", () => {
    expect(getStaticTailwindFontSize("text-[..px]")).toBeNull();
  });

  it("supports length hints and important precedence", () => {
    expect(getStaticTailwindFontSize("text-[length:12px]")).toBe(12);
    expect(getStaticTailwindFontSize("text-[length:12px]/5")).toBe(12);
    expect(getStaticTailwindFontSize("text-xs/5")).toBe(12);
    expect(getStaticTailwindFontSize("!text-xs text-base")).toBe(12);
    expect(getStaticTailwindFontSize("text-xs !text-base text-xs")).toBe(16);
    expect(getStaticTailwindFontSize("text-xs text-base!")).toBe(16);
  });
});
