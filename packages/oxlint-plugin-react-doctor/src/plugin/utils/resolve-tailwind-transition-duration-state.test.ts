import { describe, expect, it } from "vite-plus/test";
import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import { resolveTailwindTransitionDurationState } from "./resolve-tailwind-transition-duration-state.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";

const ALL_TRANSITION_PROPERTY_NAMES = new Set(["all"]);
const SCALE_TRANSITION_PROPERTY_NAMES = new Set(["scale", "transform"]);

const resolveState = (className: string, propertyNames: ReadonlySet<string>): boolean | null =>
  resolveTailwindTransitionDurationState(
    splitTailwindClassName(className).map(parseTailwindClassNameToken),
    [],
    propertyNames,
  );

describe("resolveTailwindTransitionDurationState", () => {
  it("pairs mixed duration lists with transition property indices", () => {
    expect(resolveState("transition-all duration-[200ms,0ms]", ALL_TRANSITION_PROPERTY_NAMES)).toBe(
      true,
    );
    expect(
      resolveState("transition-[opacity,all] duration-[0ms,200ms]", ALL_TRANSITION_PROPERTY_NAMES),
    ).toBe(true);
    expect(
      resolveState(
        "[transition-property:opacity,all] [transition-duration:0ms,200ms]",
        ALL_TRANSITION_PROPERTY_NAMES,
      ),
    ).toBe(true);
  });

  it("uses the duration paired with transform and scale properties", () => {
    expect(
      resolveState(
        "transition-[opacity,transform] duration-[0ms,200ms]",
        SCALE_TRANSITION_PROPERTY_NAMES,
      ),
    ).toBe(true);
    expect(
      resolveState(
        "transition-[opacity,transform] duration-[200ms,0ms]",
        SCALE_TRANSITION_PROPERTY_NAMES,
      ),
    ).toBe(false);
  });

  it("keeps unresolved property and duration lists unknown", () => {
    expect(
      resolveState("transition duration-[0ms,200ms]", SCALE_TRANSITION_PROPERTY_NAMES),
    ).toBeNull();
    expect(
      resolveState(
        "transition-[opacity,transform] duration-[0ms,200ms] duration-[200ms,0ms]",
        SCALE_TRANSITION_PROPERTY_NAMES,
      ),
    ).toBeNull();
  });
});
