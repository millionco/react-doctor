import { describe, expect, it } from "vite-plus/test";
import { getEffectiveTailwindClassNameToken } from "./get-effective-tailwind-class-name-token.js";

describe("getEffectiveTailwindClassNameToken", () => {
  it("returns null for distinct utilities with equal priority", () => {
    expect(getEffectiveTailwindClassNameToken(["uppercase", "normal-case"], () => true)).toBeNull();
    expect(
      getEffectiveTailwindClassNameToken(["!uppercase", "normal-case!"], () => true),
    ).toBeNull();
  });

  it("does not treat duplicate utilities as conflicts", () => {
    expect(getEffectiveTailwindClassNameToken(["uppercase", "uppercase"], () => true)).toBe(
      "uppercase",
    );
  });

  it("keeps important utilities authoritative regardless of source order", () => {
    expect(getEffectiveTailwindClassNameToken(["!normal-case", "uppercase"], () => true)).toBe(
      "normal-case",
    );
    expect(getEffectiveTailwindClassNameToken(["normal-case", "!uppercase"], () => true)).toBe(
      "uppercase",
    );
  });

  it("accepts trailing important modifiers and ignores variant-only utilities", () => {
    expect(
      getEffectiveTailwindClassNameToken(
        ["uppercase", "normal-case!", "hover:uppercase"],
        () => true,
      ),
    ).toBe("normal-case");
  });
});
