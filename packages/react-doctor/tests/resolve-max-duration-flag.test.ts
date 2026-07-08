import { describe, expect, it } from "vite-plus/test";
import { resolveMaxDurationFlag } from "../src/cli/utils/resolve-max-duration-flag.js";

describe("resolveMaxDurationFlag", () => {
  it("returns undefined when the flag is unset", () => {
    expect(resolveMaxDurationFlag(undefined)).toBeUndefined();
  });

  it("converts seconds to milliseconds", () => {
    expect(resolveMaxDurationFlag("300")).toBe(300_000);
    expect(resolveMaxDurationFlag("0.5")).toBe(500);
  });

  it("ignores invalid or non-positive values", () => {
    expect(resolveMaxDurationFlag("abc")).toBeUndefined();
    expect(resolveMaxDurationFlag("0")).toBeUndefined();
    expect(resolveMaxDurationFlag("-30")).toBeUndefined();
    expect(resolveMaxDurationFlag("Infinity")).toBeUndefined();
  });
});
