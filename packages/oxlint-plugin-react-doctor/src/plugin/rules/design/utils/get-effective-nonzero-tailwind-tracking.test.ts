import { describe, expect, it } from "vite-plus/test";
import { getEffectiveNonzeroTailwindTracking } from "./get-effective-nonzero-tailwind-tracking.js";

describe("getEffectiveNonzeroTailwindTracking", () => {
  it("returns a single nonzero tracking utility", () => {
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide"])).toBe("tracking-wide");
    expect(getEffectiveNonzeroTailwindTracking(["-tracking-[0.02em]"])).toBe("-tracking-[0.02em]");
    expect(getEffectiveNonzeroTailwindTracking(["tracking-[length:.02em]"])).toBe(
      "tracking-[length:.02em]",
    );
  });

  it("returns null for distinct utilities with equal priority", () => {
    expect(getEffectiveNonzeroTailwindTracking(["tracking-normal", "tracking-wide"])).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide", "-tracking-[0.02em]"])).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["!tracking-wide", "tracking-wider!"])).toBeNull();
  });

  it("does not treat duplicate utilities as conflicts", () => {
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide", "tracking-wide"])).toBe(
      "tracking-wide",
    );
  });

  it("returns null when the effective tracking is normal or zero in any length unit", () => {
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide", "tracking-normal"])).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide", "tracking-[0rem]"])).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide", "tracking-[0.00PX]"])).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide", "-tracking-[0rem]"])).toBeNull();
  });

  it("returns null for unresolved or invalid arbitrary tracking", () => {
    expect(
      getEffectiveNonzeroTailwindTracking(["tracking-wide", "tracking-[var(--space)]"]),
    ).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide", "tracking-[banana]"])).toBeNull();
    expect(
      getEffectiveNonzeroTailwindTracking(["tracking-wide", "tracking-[calc(0rem)]"]),
    ).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-brand"])).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-(--brand)"])).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-wide", "!tracking-brand"])).toBeNull();
  });

  it("honors important tracking precedence", () => {
    expect(getEffectiveNonzeroTailwindTracking(["!tracking-normal", "tracking-wide"])).toBeNull();
    expect(getEffectiveNonzeroTailwindTracking(["tracking-normal", "!tracking-wide"])).toBe(
      "tracking-wide",
    );
  });
});
