import { describe, expect, it } from "vite-plus/test";
import { getTailwindVisibilityEffect } from "./get-tailwind-visibility-effect.js";

describe("getTailwindVisibilityEffect", () => {
  it("distinguishes known, unknown, and unrelated utilities", () => {
    expect(getTailwindVisibilityEffect("hidden")).toEqual({
      isVisible: false,
      propertyName: "display",
      status: "known",
    });
    expect(getTailwindVisibilityEffect("[display:var(--layout)]")).toEqual({
      isVisible: null,
      propertyName: "display",
      status: "unknown",
    });
    expect(getTailwindVisibilityEffect("[visibility:var(--visibility)]")).toEqual({
      isVisible: null,
      propertyName: "visibility",
      status: "unknown",
    });
    expect(getTailwindVisibilityEffect("text-red-500")).toEqual({
      isVisible: null,
      propertyName: null,
      status: "not-relevant",
    });
  });

  it("matches arbitrary CSS property names case-insensitively", () => {
    expect(getTailwindVisibilityEffect("[dIsPlAy:none]")).toEqual({
      isVisible: false,
      propertyName: "display",
      status: "known",
    });
    expect(getTailwindVisibilityEffect("[VISIBILITY:VISIBLE]")).toEqual({
      isVisible: true,
      propertyName: "visibility",
      status: "known",
    });
    expect(getTailwindVisibilityEffect("[DiSpLaY:var(--layout)]")).toEqual({
      isVisible: null,
      propertyName: "display",
      status: "unknown",
    });
  });
});
