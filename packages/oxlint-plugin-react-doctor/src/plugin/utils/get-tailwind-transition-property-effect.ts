import { getCssTransitionShorthandEvidence } from "../rules/design/utils/get-css-transition-shorthand-evidence.js";
import { getTailwindArbitraryUtilityValue } from "./get-tailwind-arbitrary-utility-value.js";
import { normalizeTailwindArbitraryUtilityValue } from "./normalize-tailwind-arbitrary-utility-value.js";

export interface TailwindTransitionPropertyEffect {
  includesAll: boolean;
  includesScale: boolean;
  includesTransform: boolean;
  propertyNames: ReadonlyArray<string> | null;
}

const KNOWN_TRANSITION_PROPERTY_EFFECTS = new Map<string, TailwindTransitionPropertyEffect>([
  [
    "transition-none",
    { includesAll: false, includesScale: false, includesTransform: false, propertyNames: ["none"] },
  ],
  [
    "transition",
    { includesAll: false, includesScale: true, includesTransform: true, propertyNames: null },
  ],
  [
    "transition-all",
    { includesAll: true, includesScale: true, includesTransform: true, propertyNames: ["all"] },
  ],
  [
    "transition-colors",
    { includesAll: false, includesScale: false, includesTransform: false, propertyNames: null },
  ],
  [
    "transition-opacity",
    {
      includesAll: false,
      includesScale: false,
      includesTransform: false,
      propertyNames: ["opacity"],
    },
  ],
  [
    "transition-shadow",
    {
      includesAll: false,
      includesScale: false,
      includesTransform: false,
      propertyNames: ["box-shadow"],
    },
  ],
  [
    "transition-transform",
    {
      includesAll: false,
      includesScale: true,
      includesTransform: true,
      propertyNames: ["transform"],
    },
  ],
]);

const TRANSITION_PROPERTY_UTILITY_PREFIX = "transition-[";
const ARBITRARY_TRANSITION_PROPERTY_PREFIX = "[transition-property:";
const ARBITRARY_TRANSITION_SHORTHAND_PREFIX = "[transition:";

const getTransitionPropertyEffect = (propertyValue: string): TailwindTransitionPropertyEffect => {
  const transitionPropertyNames = propertyValue
    .split(",")
    .map((transitionPropertyName) => transitionPropertyName.trim().toLowerCase());
  const includesAll = transitionPropertyNames.includes("all");
  return {
    includesAll,
    includesScale: includesAll || transitionPropertyNames.includes("scale"),
    includesTransform: includesAll || transitionPropertyNames.includes("transform"),
    propertyNames: transitionPropertyNames,
  };
};

export const getTailwindTransitionPropertyEffect = (
  utility: string,
): TailwindTransitionPropertyEffect | null => {
  const knownEffect = KNOWN_TRANSITION_PROPERTY_EFFECTS.get(utility);
  if (knownEffect) return knownEffect;

  const transitionPropertyValue =
    getTailwindArbitraryUtilityValue(utility, TRANSITION_PROPERTY_UTILITY_PREFIX) ??
    getTailwindArbitraryUtilityValue(utility, ARBITRARY_TRANSITION_PROPERTY_PREFIX);
  if (transitionPropertyValue !== null) {
    return getTransitionPropertyEffect(
      normalizeTailwindArbitraryUtilityValue(transitionPropertyValue),
    );
  }

  const transitionShorthandValue = getTailwindArbitraryUtilityValue(
    utility,
    ARBITRARY_TRANSITION_SHORTHAND_PREFIX,
  );
  if (transitionShorthandValue === null) return null;
  const normalizedValue = normalizeTailwindArbitraryUtilityValue(transitionShorthandValue);
  const transitions = getCssTransitionShorthandEvidence(normalizedValue);
  const includesAll = transitions.some((transition) => transition.propertyName === "all");
  return {
    includesAll,
    includesScale:
      includesAll || transitions.some((transition) => transition.propertyName === "scale"),
    includesTransform:
      includesAll || transitions.some((transition) => transition.propertyName === "transform"),
    propertyNames: transitions.map((transition) => transition.propertyName),
  };
};
