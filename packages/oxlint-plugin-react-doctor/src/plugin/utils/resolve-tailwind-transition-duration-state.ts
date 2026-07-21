import { getCssTransitionShorthandEvidence } from "../rules/design/utils/get-css-transition-shorthand-evidence.js";
import { doesTailwindVariantScopeCover } from "./does-tailwind-variant-scope-cover.js";
import { getHighestPriorityTailwindClassNameTokens } from "./get-highest-priority-tailwind-class-name-tokens.js";
import { getTailwindArbitraryUtilityValue } from "./get-tailwind-arbitrary-utility-value.js";
import { getTailwindTransitionPropertyEffect } from "./get-tailwind-transition-property-effect.js";
import { normalizeTailwindArbitraryUtilityValue } from "./normalize-tailwind-arbitrary-utility-value.js";
import type { TailwindClassNameToken } from "./parse-tailwind-class-name-token.js";

interface TailwindTransitionDurationEffect {
  durationStates: ReadonlyArray<boolean> | null;
  isExplicitDuration: boolean;
}

const CSS_TIME_PATTERN = /^([+-]?\d*\.?\d+)(?:ms|s)$/i;
const TRANSITION_DURATION_ARBITRARY_PREFIX = "[transition-duration:";
const TRANSITION_SHORTHAND_ARBITRARY_PREFIX = "[transition:";

const getDurationListStates = (value: string): boolean[] | null => {
  const states: boolean[] = [];
  for (const rawDuration of value.split(",")) {
    const duration = rawDuration.trim();
    const durationMatch = CSS_TIME_PATTERN.exec(duration);
    if (!durationMatch) return null;
    const durationNumber = Number(durationMatch[1]);
    if (durationNumber < 0) return null;
    states.push(durationNumber > 0);
  }
  return states.length > 0 ? states : null;
};

const getDurationUtilityStates = (utility: string): boolean[] | null | undefined => {
  if (!utility.startsWith("duration-")) return undefined;
  const rawDuration = utility.slice("duration-".length);
  if (rawDuration.startsWith("[") && rawDuration.endsWith("]")) {
    return getDurationListStates(normalizeTailwindArbitraryUtilityValue(rawDuration.slice(1, -1)));
  }
  if (!/^\d*\.?\d+$/.test(rawDuration)) return null;
  return [Number(rawDuration) > 0];
};

const getTransitionDurationEffect = (
  utility: string,
  targetPropertyNames: ReadonlySet<string>,
): TailwindTransitionDurationEffect | undefined => {
  const durationUtilityStates = getDurationUtilityStates(utility);
  if (durationUtilityStates !== undefined) {
    return { durationStates: durationUtilityStates, isExplicitDuration: true };
  }

  const arbitraryDuration = getTailwindArbitraryUtilityValue(
    utility,
    TRANSITION_DURATION_ARBITRARY_PREFIX,
  );
  if (arbitraryDuration !== null) {
    return {
      durationStates: getDurationListStates(
        normalizeTailwindArbitraryUtilityValue(arbitraryDuration),
      ),
      isExplicitDuration: true,
    };
  }

  const arbitraryShorthand = getTailwindArbitraryUtilityValue(
    utility,
    TRANSITION_SHORTHAND_ARBITRARY_PREFIX,
  );
  if (arbitraryShorthand !== null) {
    const transitions = getCssTransitionShorthandEvidence(
      normalizeTailwindArbitraryUtilityValue(arbitraryShorthand),
    );
    if (transitions.length === 0) {
      return { durationStates: null, isExplicitDuration: false };
    }
    const durationStates = transitions
      .filter(
        (transition) =>
          transition.propertyName === "all" || targetPropertyNames.has(transition.propertyName),
      )
      .map((transition) => transition.hasPositiveDuration);
    return durationStates.length > 0 ? { durationStates, isExplicitDuration: false } : undefined;
  }

  if (utility.startsWith("[transition-property:")) return undefined;
  const propertyEffect = getTailwindTransitionPropertyEffect(utility);
  if (!propertyEffect) return undefined;
  const targetsRequestedProperty =
    (targetPropertyNames.has("all") && propertyEffect.includesAll) ||
    (targetPropertyNames.has("scale") && propertyEffect.includesScale) ||
    (targetPropertyNames.has("transform") && propertyEffect.includesTransform);
  return targetsRequestedProperty
    ? { durationStates: [true], isExplicitDuration: false }
    : undefined;
};

const getEffectiveTransitionPropertyNames = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
): ReadonlyArray<string> | null => {
  const highestPriorityPropertyTokens = getHighestPriorityTailwindClassNameTokens(
    parsedTokens,
    (parsedToken) =>
      doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope) &&
      getTailwindTransitionPropertyEffect(parsedToken.utility) !== null,
  );
  if (highestPriorityPropertyTokens.length === 0) return ["all"];
  const propertyNamesByToken = highestPriorityPropertyTokens.map(
    (parsedToken) =>
      getTailwindTransitionPropertyEffect(parsedToken.utility)?.propertyNames ?? null,
  );
  if (propertyNamesByToken.some((propertyNames) => propertyNames === null)) return null;
  const serializedPropertyNames = new Set(
    propertyNamesByToken.map((propertyNames) => JSON.stringify(propertyNames)),
  );
  return serializedPropertyNames.size === 1 ? (propertyNamesByToken[0] ?? null) : null;
};

const resolveDurationEffectState = (
  effect: TailwindTransitionDurationEffect,
  propertyNames: ReadonlyArray<string> | null,
  targetPropertyNames: ReadonlySet<string>,
): boolean | null => {
  if (!effect.durationStates || effect.durationStates.length === 0) return null;
  const unpairedStates = new Set(effect.durationStates);
  if (unpairedStates.size === 1) return unpairedStates.values().next().value ?? null;
  if (!effect.isExplicitDuration || !propertyNames) return null;
  const pairedStates = new Set(
    propertyNames.flatMap((propertyName, propertyIndex) => {
      if (propertyName !== "all" && !targetPropertyNames.has(propertyName)) return [];
      const durationState = effect.durationStates?.[propertyIndex % effect.durationStates.length];
      return durationState === undefined ? [] : [durationState];
    }),
  );
  return pairedStates.size === 1 ? (pairedStates.values().next().value ?? null) : null;
};

export const resolveTailwindTransitionDurationState = (
  parsedTokens: ReadonlyArray<TailwindClassNameToken>,
  targetVariantScope: ReadonlyArray<string>,
  targetPropertyNames: ReadonlySet<string>,
): boolean | null => {
  const highestPriorityTokens = getHighestPriorityTailwindClassNameTokens(
    parsedTokens,
    (parsedToken) =>
      doesTailwindVariantScopeCover(parsedToken.variants, targetVariantScope) &&
      getTransitionDurationEffect(parsedToken.utility, targetPropertyNames) !== undefined,
  );
  const highestPriorityEffects = highestPriorityTokens.flatMap((parsedToken) => {
    const effect = getTransitionDurationEffect(parsedToken.utility, targetPropertyNames);
    return effect ? [effect] : [];
  });
  const hasExplicitDuration = highestPriorityEffects.some((effect) => effect.isExplicitDuration);
  const effectiveDurationEffects = hasExplicitDuration
    ? highestPriorityEffects.filter((effect) => effect.isExplicitDuration)
    : highestPriorityEffects;
  const propertyNames = getEffectiveTransitionPropertyNames(parsedTokens, targetVariantScope);
  const states = new Set(
    effectiveDurationEffects.map((effect) =>
      resolveDurationEffectState(effect, propertyNames, targetPropertyNames),
    ),
  );
  return states.size === 1 ? (states.values().next().value ?? null) : null;
};
