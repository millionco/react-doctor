import type { Selector, SelectorComponent } from "lightningcss";
import { compareStaticCssSelectorSpecificity } from "./compare-static-css-selector-specificity.js";

export interface StaticCssSelectorSpecificity {
  readonly classCount: number;
  readonly elementCount: number;
  readonly idCount: number;
}

const ZERO_SPECIFICITY: StaticCssSelectorSpecificity = {
  classCount: 0,
  elementCount: 0,
  idCount: 0,
};

const addSpecificities = (
  leftSpecificity: StaticCssSelectorSpecificity,
  rightSpecificity: StaticCssSelectorSpecificity,
): StaticCssSelectorSpecificity => ({
  classCount: leftSpecificity.classCount + rightSpecificity.classCount,
  elementCount: leftSpecificity.elementCount + rightSpecificity.elementCount,
  idCount: leftSpecificity.idCount + rightSpecificity.idCount,
});

const getHighestSpecificity = (selectors: ReadonlyArray<Selector>): StaticCssSelectorSpecificity =>
  selectors
    .map(getStaticCssSelectorSpecificity)
    .reduce(
      (highestSpecificity, specificity) =>
        compareStaticCssSelectorSpecificity(specificity, highestSpecificity) > 0
          ? specificity
          : highestSpecificity,
      ZERO_SPECIFICITY,
    );

const getPseudoClassSpecificity = (
  component: Extract<SelectorComponent, { type: "pseudo-class" }>,
): StaticCssSelectorSpecificity => {
  if (component.kind === "where") return ZERO_SPECIFICITY;
  if (
    component.kind === "is" ||
    component.kind === "not" ||
    component.kind === "any" ||
    component.kind === "has"
  ) {
    return getHighestSpecificity(component.selectors);
  }
  if (component.kind === "local" || component.kind === "global") {
    return getStaticCssSelectorSpecificity(component.selector);
  }
  if (component.kind === "nth-child" || component.kind === "nth-last-child") {
    return addSpecificities(
      { classCount: 1, elementCount: 0, idCount: 0 },
      component.of ? getHighestSpecificity(component.of) : ZERO_SPECIFICITY,
    );
  }
  if (component.kind === "host" && component.selectors) {
    return addSpecificities(
      { classCount: 1, elementCount: 0, idCount: 0 },
      getStaticCssSelectorSpecificity(component.selectors),
    );
  }
  return { classCount: 1, elementCount: 0, idCount: 0 };
};

const getSelectorComponentSpecificity = (
  component: SelectorComponent,
): StaticCssSelectorSpecificity => {
  if (component.type === "id") return { classCount: 0, elementCount: 0, idCount: 1 };
  if (component.type === "class" || component.type === "attribute") {
    return { classCount: 1, elementCount: 0, idCount: 0 };
  }
  if (component.type === "type" || component.type === "pseudo-element") {
    return { classCount: 0, elementCount: 1, idCount: 0 };
  }
  if (component.type === "pseudo-class") return getPseudoClassSpecificity(component);
  return ZERO_SPECIFICITY;
};

export const getStaticCssSelectorSpecificity = (selector: Selector): StaticCssSelectorSpecificity =>
  selector.reduce(
    (specificity, component) =>
      addSpecificities(specificity, getSelectorComponentSpecificity(component)),
    ZERO_SPECIFICITY,
  );
