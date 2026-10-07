import {
  ONE_SECOND_MS,
  POSITIVE_TRANSITION_DURATION_EVIDENCE_MS,
} from "../../../constants/design.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../../utils/get-effective-object-properties-in-insertion-order.js";
import { getCssTransitionShorthandEvidence } from "./get-css-transition-shorthand-evidence.js";
import { getStylePropertyKey } from "./get-style-property-key.js";
import { getStylePropertyStringValue } from "./get-style-property-string-value.js";

export interface EffectiveCssTransitionEvidence {
  durationMilliseconds: number;
  propertyName: string;
  sourceNode: EsTreeNode;
}

export interface CssTransitionDefaultEvidence {
  hasPositiveDuration: boolean;
  propertyName: string;
  sourceNode: EsTreeNode;
}

export interface CssTransitionProtectedProperties {
  duration: boolean;
  property: boolean;
}

interface CssTransitionListState {
  durationsMilliseconds: number[];
  durationSourceNodes: EsTreeNode[];
  propertyNames: string[];
  propertySourceNodes: Array<EsTreeNode | null>;
}

const CSS_TIME_PATTERN = /^(\d*\.?\d+)(ms|s)$/i;
const CSS_TRANSITION_STYLE_PROPERTY_NAMES = new Set([
  "transition",
  "transitionDuration",
  "transitionProperty",
]);

const parseCssTransitionDurationList = (value: string): number[] | null => {
  const durationsMilliseconds: number[] = [];
  for (const rawDuration of value.split(",")) {
    const durationMatch = CSS_TIME_PATTERN.exec(rawDuration.trim());
    if (!durationMatch) return null;
    const duration = Number(durationMatch[1]);
    durationsMilliseconds.push(
      durationMatch[2]?.toLowerCase() === "s" ? duration * ONE_SECOND_MS : duration,
    );
  }
  return durationsMilliseconds.length > 0 ? durationsMilliseconds : null;
};

const parseCssTransitionPropertyList = (value: string): string[] | null => {
  const propertyNames = value.split(",").map((propertyName) => propertyName.trim().toLowerCase());
  if (
    propertyNames.length === 0 ||
    propertyNames.some(
      (propertyName) => !/^(?:all|none|--[a-z0-9_-]+|-?[a-z][a-z0-9-]*)$/i.test(propertyName),
    ) ||
    (propertyNames.includes("none") && propertyNames.length > 1)
  ) {
    return null;
  }
  return propertyNames;
};

export const getEffectiveCssTransitionEvidence = (
  properties: ReadonlyArray<EsTreeNode> | undefined,
  defaultEvidence: ReadonlyArray<CssTransitionDefaultEvidence> = [],
  protectedProperties: CssTransitionProtectedProperties = { duration: false, property: false },
): EffectiveCssTransitionEvidence[] | null => {
  const effectiveObjectProperties = getEffectiveObjectPropertiesInInsertionOrder(properties);
  const effectiveProperties = effectiveObjectProperties?.filter((property) => {
    const propertyName = getStylePropertyKey(property);
    return propertyName ? CSS_TRANSITION_STYLE_PROPERTY_NAMES.has(propertyName) : false;
  });
  if (!effectiveProperties) return null;
  const transitionState: CssTransitionListState = {
    durationsMilliseconds: defaultEvidence.map((transition) =>
      transition.hasPositiveDuration ? POSITIVE_TRANSITION_DURATION_EVIDENCE_MS : 0,
    ),
    durationSourceNodes: defaultEvidence.map((transition) => transition.sourceNode),
    propertyNames: defaultEvidence.map((transition) => transition.propertyName),
    propertySourceNodes: defaultEvidence.map((transition) => transition.sourceNode),
  };
  if (defaultEvidence.length === 0) {
    transitionState.durationsMilliseconds = [0];
    transitionState.propertyNames = ["all"];
    transitionState.propertySourceNodes = [null];
  }

  for (const property of effectiveProperties) {
    const propertyName = getStylePropertyKey(property);
    const propertyValue = getStylePropertyStringValue(property);
    if (!propertyName || propertyValue === null) return null;
    if (propertyName === "transition") {
      const shorthandEvidence = getCssTransitionShorthandEvidence(propertyValue);
      if (shorthandEvidence.length === 0) return null;
      if (!protectedProperties.property) {
        transitionState.propertyNames = shorthandEvidence.map(
          (transition) => transition.propertyName,
        );
        transitionState.propertySourceNodes = shorthandEvidence.map(() => property);
      }
      if (!protectedProperties.duration) {
        transitionState.durationsMilliseconds = shorthandEvidence.map(
          (transition) => transition.durationMilliseconds,
        );
        transitionState.durationSourceNodes = shorthandEvidence.map(() => property);
      }
      continue;
    }
    if (propertyName === "transitionProperty") {
      if (protectedProperties.property) continue;
      const propertyNames = parseCssTransitionPropertyList(propertyValue);
      if (!propertyNames) return null;
      transitionState.propertyNames = propertyNames;
      transitionState.propertySourceNodes = propertyNames.map(() => property);
      continue;
    }
    if (protectedProperties.duration) continue;
    const durationsMilliseconds = parseCssTransitionDurationList(propertyValue);
    if (!durationsMilliseconds) return null;
    transitionState.durationsMilliseconds = durationsMilliseconds;
    transitionState.durationSourceNodes = durationsMilliseconds.map(() => property);
  }

  if (transitionState.propertyNames.includes("none")) return [];
  return transitionState.propertyNames
    .map((propertyName, propertyIndex) => {
      const durationIndex = propertyIndex % transitionState.durationsMilliseconds.length;
      const propertySource = transitionState.propertySourceNodes[propertyIndex];
      const durationSource = transitionState.durationSourceNodes[durationIndex];
      return {
        durationMilliseconds: transitionState.durationsMilliseconds[durationIndex] ?? 0,
        propertyName,
        sourceNode: propertySource ?? durationSource,
      };
    })
    .filter((transition): transition is EffectiveCssTransitionEvidence =>
      Boolean(transition.sourceNode),
    );
};
