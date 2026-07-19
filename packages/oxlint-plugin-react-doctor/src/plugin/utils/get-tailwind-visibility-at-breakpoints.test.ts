import { describe, expect, it } from "vite-plus/test";
import { getTailwindVisibilityAtBreakpoints } from "./get-tailwind-visibility-at-breakpoints.js";

describe("getTailwindVisibilityAtBreakpoints", () => {
  it("inherits visibility through later breakpoints", () => {
    expect(getTailwindVisibilityAtBreakpoints("block md:hidden")).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(getTailwindVisibilityAtBreakpoints("hidden md:grid")).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
  });

  it("ignores non-responsive variants", () => {
    expect(getTailwindVisibilityAtBreakpoints("block hover:hidden")).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("returns null for conflicting visibility utilities", () => {
    expect(getTailwindVisibilityAtBreakpoints("hidden block")).toBeNull();
  });
});
