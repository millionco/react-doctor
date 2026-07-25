import { describe, expect, it } from "vite-plus/test";
import { parseStaticTailwindLengthPx } from "./parse-static-tailwind-length-px.js";

describe("parseStaticTailwindLengthPx", () => {
  it("parses the spacing scale and pixel utility", () => {
    expect(parseStaticTailwindLengthPx("w-px", "w")).toBe(1);
    expect(parseStaticTailwindLengthPx("w-7", "w")).toBe(28);
    expect(parseStaticTailwindLengthPx("h-0.5", "h")).toBe(2);
  });

  it("parses static arbitrary pixel and rem lengths", () => {
    expect(parseStaticTailwindLengthPx("w-[2rem]", "w")).toBe(32);
    expect(parseStaticTailwindLengthPx("h-[length:3px]", "h")).toBe(3);
  });

  it("rejects unrelated, dynamic, negative, and unitless arbitrary values", () => {
    expect(parseStaticTailwindLengthPx("h-7", "w")).toBeNull();
    expect(parseStaticTailwindLengthPx("w-[var(--width)]", "w")).toBeNull();
    expect(parseStaticTailwindLengthPx("-w-2", "w")).toBeNull();
    expect(parseStaticTailwindLengthPx("w-[8]", "w")).toBeNull();
  });
});
