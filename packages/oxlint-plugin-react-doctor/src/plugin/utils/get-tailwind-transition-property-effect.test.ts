import { describe, expect, it } from "vite-plus/test";
import { getTailwindTransitionPropertyEffect } from "./get-tailwind-transition-property-effect.js";

describe("getTailwindTransitionPropertyEffect", () => {
  it("classifies built-in transition-property utilities", () => {
    expect(getTailwindTransitionPropertyEffect("transition-none")).toEqual({
      includesAll: false,
      includesScale: false,
      includesTransform: false,
      propertyNames: ["none"],
    });
    expect(getTailwindTransitionPropertyEffect("transition")).toEqual({
      includesAll: false,
      includesScale: true,
      includesTransform: true,
      propertyNames: null,
    });
    expect(getTailwindTransitionPropertyEffect("transition-all")).toEqual({
      includesAll: true,
      includesScale: true,
      includesTransform: true,
      propertyNames: ["all"],
    });
    expect(getTailwindTransitionPropertyEffect("transition-colors")).toEqual({
      includesAll: false,
      includesScale: false,
      includesTransform: false,
      propertyNames: null,
    });
  });

  it("classifies arbitrary property and shorthand utilities", () => {
    expect(getTailwindTransitionPropertyEffect("transition-[opacity,transform]")).toEqual({
      includesAll: false,
      includesScale: false,
      includesTransform: true,
      propertyNames: ["opacity", "transform"],
    });
    expect(getTailwindTransitionPropertyEffect("[transition-property:all]")).toEqual({
      includesAll: true,
      includesScale: true,
      includesTransform: true,
      propertyNames: ["all"],
    });
    expect(getTailwindTransitionPropertyEffect("[transition:200ms_transform]")).toEqual({
      includesAll: false,
      includesScale: false,
      includesTransform: true,
      propertyNames: ["transform"],
    });
    expect(getTailwindTransitionPropertyEffect("[transition:all]")).toEqual({
      includesAll: true,
      includesScale: true,
      includesTransform: true,
      propertyNames: ["all"],
    });
  });

  it("ignores transition utilities that do not set transition-property", () => {
    expect(getTailwindTransitionPropertyEffect("transition-discrete")).toBeNull();
    expect(getTailwindTransitionPropertyEffect("duration-200")).toBeNull();
  });
});
