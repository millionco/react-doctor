import { describe, expect, it } from "vite-plus/test";
import { resolveEffectiveTailwindClassNameToken } from "./resolve-effective-tailwind-class-name-token.js";

describe("resolveEffectiveTailwindClassNameToken", () => {
  it("distinguishes no matching utility from an ambiguous conflict", () => {
    expect(resolveEffectiveTailwindClassNameToken(["flex"], () => false)).toEqual({
      isAmbiguous: false,
      isImportant: false,
      utility: null,
    });
    expect(
      resolveEffectiveTailwindClassNameToken(["w-auto", "w-10"], (utility) =>
        utility.startsWith("w-"),
      ),
    ).toEqual({ isAmbiguous: true, isImportant: false, utility: null });
  });

  it("resolves duplicates and a single winning priority tier", () => {
    expect(
      resolveEffectiveTailwindClassNameToken(["w-10", "w-10"], (utility) =>
        utility.startsWith("w-"),
      ),
    ).toEqual({ isAmbiguous: false, isImportant: false, utility: "w-10" });
    expect(
      resolveEffectiveTailwindClassNameToken(["!w-10", "w-auto"], (utility) =>
        utility.startsWith("w-"),
      ),
    ).toEqual({ isAmbiguous: false, isImportant: true, utility: "w-10" });
  });

  it("keeps distinct important utilities ambiguous", () => {
    expect(
      resolveEffectiveTailwindClassNameToken(["!w-10", "w-auto!"], (utility) =>
        utility.startsWith("w-"),
      ),
    ).toEqual({ isAmbiguous: true, isImportant: false, utility: null });
  });

  it("resolves the most specific applicable target scope without inferring breakpoint order", () => {
    expect(
      resolveEffectiveTailwindClassNameToken(
        ["scale-100", "group-hover/card:scale-105", "group-hover/other:!scale-100"],
        (utility) => utility.startsWith("scale-"),
        ["group-hover/card"],
      ),
    ).toEqual({ isAmbiguous: false, isImportant: false, utility: "scale-105" });
    expect(
      resolveEffectiveTailwindClassNameToken(
        ["md:scale-105", "lg:scale-100"],
        (utility) => utility.startsWith("scale-"),
        ["lg"],
      ),
    ).toEqual({ isAmbiguous: false, isImportant: false, utility: "scale-100" });
  });
});
