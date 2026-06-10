import { DIAGNOSTIC_CATEGORY_BUCKETS } from "@react-doctor/core";
import { CliInputError } from "./cli-input-error.js";

const categoryByLowercase = new Map(
  DIAGNOSTIC_CATEGORY_BUCKETS.map((category) => [category.toLowerCase(), category]),
);

const knownCategoryList = DIAGNOSTIC_CATEGORY_BUCKETS.join(", ");

const splitCategoryFlagValue = (value: string): string[] =>
  value
    .split(",")
    .map((category) => category.trim())
    .filter((category) => category.length > 0);

export const resolveCliCategories = (
  categoryFlag: string | string[] | undefined,
): string[] | undefined => {
  const rawCategoryValues =
    categoryFlag === undefined ? [] : Array.isArray(categoryFlag) ? categoryFlag : [categoryFlag];

  const resolvedCategories: string[] = [];
  const seenCategories = new Set<string>();

  for (const rawCategoryValue of rawCategoryValues) {
    for (const categoryQuery of splitCategoryFlagValue(rawCategoryValue)) {
      const matchedCategory = categoryByLowercase.get(categoryQuery.toLowerCase());
      if (matchedCategory === undefined) {
        throw new CliInputError(
          `Unknown category "${categoryQuery}". Expected one of: ${knownCategoryList}.`,
        );
      }
      if (!seenCategories.has(matchedCategory)) {
        seenCategories.add(matchedCategory);
        resolvedCategories.push(matchedCategory);
      }
    }
  }

  if (rawCategoryValues.length > 0 && resolvedCategories.length === 0) {
    throw new CliInputError(`--category requires one of: ${knownCategoryList}.`);
  }

  return resolvedCategories.length > 0 ? resolvedCategories : undefined;
};
