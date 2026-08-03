import type { StaticCssSelectorSpecificity } from "./get-static-css-selector-specificity.js";

export const compareStaticCssSelectorSpecificity = (
  leftSpecificity: StaticCssSelectorSpecificity,
  rightSpecificity: StaticCssSelectorSpecificity,
): number =>
  leftSpecificity.idCount - rightSpecificity.idCount ||
  leftSpecificity.classCount - rightSpecificity.classCount ||
  leftSpecificity.elementCount - rightSpecificity.elementCount;
