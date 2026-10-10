import {
  CODE_GRADING_MAX_JSON_DEPTH,
  CODE_GRADING_MAX_INPUT_NODES,
  CODE_GRADING_MAX_ITEM_CHARACTERS,
} from "../constants.js";

export const isBoundedGradingInput = (input: unknown): boolean => {
  const pending = [{ value: input, depth: 0 }];
  const seen = new Set<object>();
  let nodeCount = 0;
  let characterCount = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) break;
    nodeCount += 1;
    if (nodeCount > CODE_GRADING_MAX_INPUT_NODES || entry.depth > CODE_GRADING_MAX_JSON_DEPTH)
      return false;
    if (typeof entry.value === "string") characterCount += entry.value.length;
    else if (entry.value !== null && typeof entry.value === "object") {
      if (seen.has(entry.value)) return false;
      seen.add(entry.value);
      for (const [key, value] of Object.entries(entry.value)) {
        characterCount += key.length;
        pending.push({ value, depth: entry.depth + 1 });
        if (pending.length > CODE_GRADING_MAX_INPUT_NODES) return false;
      }
    }
    if (characterCount > CODE_GRADING_MAX_ITEM_CHARACTERS) return false;
  }
  return true;
};
