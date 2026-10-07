import {
  CSS_TRANSITION_SHORTHAND_MAX_TIME_VALUE_COUNT,
  ONE_SECOND_MS,
} from "../../../constants/design.js";

export interface CssTransitionShorthandEvidence {
  durationMilliseconds: number;
  hasPositiveDuration: boolean;
  propertyName: string;
}

const CSS_TIME_PATTERN = /^(-?\d*\.?\d+)(ms|s)$/i;
const CSS_TIMING_KEYWORDS = new Set([
  "ease",
  "ease-in",
  "ease-in-out",
  "ease-out",
  "linear",
  "step-end",
  "step-start",
]);
const CSS_TRANSITION_BEHAVIORS = new Set(["allow-discrete", "normal"]);
const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "revert", "revert-layer", "unset"]);

const splitAtTopLevel = (value: string, separator: string): string[] => {
  const segments: string[] = [];
  let depth = 0;
  let segmentStartIndex = 0;
  for (let characterIndex = 0; characterIndex < value.length; characterIndex += 1) {
    const character = value[characterIndex];
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character !== separator || depth > 0) continue;
    segments.push(value.slice(segmentStartIndex, characterIndex));
    segmentStartIndex = characterIndex + 1;
  }
  segments.push(value.slice(segmentStartIndex));
  return segments;
};

const tokenizeTransition = (value: string): string[] => {
  const tokens: string[] = [];
  let depth = 0;
  let tokenStartIndex = -1;
  for (let characterIndex = 0; characterIndex <= value.length; characterIndex += 1) {
    const character = value[characterIndex] ?? " ";
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(character) && depth === 0) {
      if (tokenStartIndex >= 0) tokens.push(value.slice(tokenStartIndex, characterIndex));
      tokenStartIndex = -1;
      continue;
    }
    if (tokenStartIndex < 0) tokenStartIndex = characterIndex;
  }
  return tokens;
};

const parseCssTransitionShorthandSegment = (
  rawTransition: string,
): CssTransitionShorthandEvidence | null => {
  const tokens = tokenizeTransition(rawTransition.trim().toLowerCase());
  if (tokens.length === 0 || tokens.some((token) => CSS_WIDE_KEYWORDS.has(token))) return null;
  if (tokens.length === 1 && tokens[0] === "none") {
    return { durationMilliseconds: 0, hasPositiveDuration: false, propertyName: "none" };
  }
  if (tokens.includes("none")) return null;
  let propertyName = "all";
  let durationMilliseconds = 0;
  let timeCount = 0;
  let timingFunctionCount = 0;
  let behaviorCount = 0;
  let propertyNameCount = 0;
  for (const token of tokens) {
    const timeMatch = CSS_TIME_PATTERN.exec(token);
    if (timeMatch) {
      timeCount += 1;
      if (timeCount > CSS_TRANSITION_SHORTHAND_MAX_TIME_VALUE_COUNT) return null;
      if (timeCount === 1) {
        const duration = Number(timeMatch[1]);
        if (duration < 0) return null;
        durationMilliseconds =
          timeMatch[2]?.toLowerCase() === "s" ? duration * ONE_SECOND_MS : duration;
      }
      continue;
    }
    const isTimingFunction =
      CSS_TIMING_KEYWORDS.has(token) || /^(?:cubic-bezier|linear|steps)\([^)]*\)$/.test(token);
    if (isTimingFunction) {
      timingFunctionCount += 1;
      if (timingFunctionCount > 1) return null;
      continue;
    }
    if (CSS_TRANSITION_BEHAVIORS.has(token)) {
      behaviorCount += 1;
      if (behaviorCount > 1) return null;
      continue;
    }
    propertyNameCount += 1;
    if (propertyNameCount > 1) return null;
    propertyName = token;
  }
  return { durationMilliseconds, hasPositiveDuration: durationMilliseconds > 0, propertyName };
};

export const getCssTransitionShorthandEvidence = (
  value: string,
): CssTransitionShorthandEvidence[] => {
  const transitions = splitAtTopLevel(value, ",").map(parseCssTransitionShorthandSegment);
  return transitions.some((transition) => transition === null)
    ? []
    : transitions.filter((transition) => transition !== null);
};
