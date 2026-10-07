import { describe, expect, it } from "vite-plus/test";
import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import { resolveTailwindBooleanPropertyState } from "./resolve-tailwind-boolean-property-state.js";

const getVisibilityState = (utility: string): boolean | null => {
  if (utility === "visible") return true;
  if (utility === "invisible") return false;
  return null;
};

describe("resolveTailwindBooleanPropertyState", () => {
  it("lets important utilities win normal utilities", () => {
    const tokens = ["!invisible", "visible"].map(parseTailwindClassNameToken);
    expect(resolveTailwindBooleanPropertyState(tokens, [], getVisibilityState)).toBe(false);
  });

  it("keeps equal-priority conflicts ambiguous", () => {
    const tokens = ["invisible", "visible"].map(parseTailwindClassNameToken);
    expect(resolveTailwindBooleanPropertyState(tokens, [], getVisibilityState)).toBeNull();
  });

  it("only applies utilities whose variant scope covers the target", () => {
    const tokens = ["invisible", "motion-reduce:!visible"].map(parseTailwindClassNameToken);
    expect(resolveTailwindBooleanPropertyState(tokens, ["motion-safe"], getVisibilityState)).toBe(
      false,
    );
  });

  it("lets a more-specific setter override a broader setter at the target scope", () => {
    const tokens = ["invisible", "hover:visible"].map(parseTailwindClassNameToken);
    expect(resolveTailwindBooleanPropertyState(tokens, ["hover"], getVisibilityState)).toBe(true);
    expect(resolveTailwindBooleanPropertyState(tokens, [], getVisibilityState)).toBe(false);
  });
});
