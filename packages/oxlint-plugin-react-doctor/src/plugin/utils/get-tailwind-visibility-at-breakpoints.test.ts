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

  it("applies standard maximum and range variants", () => {
    expect(getTailwindVisibilityAtBreakpoints("block max-md:hidden")).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(getTailwindVisibilityAtBreakpoints("block md:max-lg:hidden")).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
    ]);
  });

  it("returns unknown for arbitrary breakpoint visibility", () => {
    expect(getTailwindVisibilityAtBreakpoints("block max-[700px]:hidden")).toBeNull();
    expect(getTailwindVisibilityAtBreakpoints("hidden min-[700px]:block")).toBeNull();
    expect(getTailwindVisibilityAtBreakpoints("[display:var(--layout)]")).toBeNull();
    expect(getTailwindVisibilityAtBreakpoints("md:[visibility:var(--visibility)]")).toBeNull();
    expect(getTailwindVisibilityAtBreakpoints("md:[dIsPlAy:var(--layout)]")).toBeNull();
  });

  it("ignores visibility effects in empty responsive intervals", () => {
    expect(getTailwindVisibilityAtBreakpoints("md:max-sm:hidden")).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(getTailwindVisibilityAtBreakpoints("max-md:lg:[display:var(--layout)]")).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("returns unknown for unsupported variant scopes", () => {
    expect(getTailwindVisibilityAtBreakpoints("block hover:hidden")).toBeNull();
    expect(getTailwindVisibilityAtBreakpoints("block tablet:hidden")).toBeNull();
    expect(getTailwindVisibilityAtBreakpoints("block data-[state=open]:hidden")).toBeNull();
  });

  it("returns null for conflicting visibility utilities", () => {
    expect(getTailwindVisibilityAtBreakpoints("hidden block")).toBeNull();
  });

  it("uses the important tier and keeps important conflicts ambiguous", () => {
    expect(getTailwindVisibilityAtBreakpoints("!hidden block")).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(getTailwindVisibilityAtBreakpoints("!hidden block!")).toBeNull();
  });

  it("does not split spaces inside arbitrary values into visibility utilities", () => {
    expect(getTailwindVisibilityAtBreakpoints("[--layout:x hidden y] block")).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("recognizes visibility collapse and arbitrary hiding declarations", () => {
    for (const className of ["collapse", "[display:none]", "[visibility:hidden]"]) {
      expect(getTailwindVisibilityAtBreakpoints(className)).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
      ]);
    }
    expect(getTailwindVisibilityAtBreakpoints("invisible block")).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("lets later minimum breakpoints override earlier setters", () => {
    expect(getTailwindVisibilityAtBreakpoints("hidden md:block lg:hidden")).toEqual([
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
    expect(getTailwindVisibilityAtBreakpoints("hidden md:block lg:grid")).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
  });
});
