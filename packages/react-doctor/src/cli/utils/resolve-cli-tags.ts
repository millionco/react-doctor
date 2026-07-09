import { list RuleTags } from "./rule-catalog.js";
import { CliInputError } from "./cli-input-error.js";

const splitTagFlagValue = (value: string): string[] =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

export const resolveCliTags = (
  tagFlag: string | string[] | undefined,
): string[] | undefined => {
  const rawTagValues =
    tagFlag === undefined ? [] : Array.isArray(tagFlag) ? tagFlag : [tagFlag];

  const resolvedTags: string[] = [];
  const seenTags = new Set<string>();

  for (const rawTagValue of rawTagValues) {
    for (const tagQuery of splitTagFlagValue(rawTagValue)) {
      // Tags are case-sensitive and don't need normalization like categories
      if (!seenTags.has(tagQuery)) {
        seenTags.add(tagQuery);
        resolvedTags.push(tagQuery);
      }
    }
  }

  return resolvedTags.length > 0 ? resolvedTags : undefined;
};
