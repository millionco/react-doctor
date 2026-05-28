import type { ProjectInfo } from "../types/index.js";

// React Compiler's `immutability` rule fires on the canonical Reanimated
// pattern `sharedValue.value = ...` because the Compiler treats hook
// return values as immutable. The generic "move the modification into the
// hook" suggestion can't be satisfied for a library-owned value, so point
// users at Reanimated's Compiler-compliant `.get()` / `.set()` accessors
// instead. Gated to projects that actually depend on react-native-reanimated
// so the hint never appears where it can't apply.
// Docs: https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/#react-compiler-support
const REANIMATED_SHARED_VALUE_HINT =
  "If this is a Reanimated shared value, prefer its React Compiler-compatible `.get()` / `.set()` accessors over `.value` — https://docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue/#react-compiler-support";

export const appendReanimatedSharedValueHint = (
  help: string,
  rule: string,
  project: ProjectInfo,
): string => {
  if (rule !== "immutability") return help;
  if (!project.hasReanimated) return help;
  if (!help) return REANIMATED_SHARED_VALUE_HINT;
  return `${help}\n\n${REANIMATED_SHARED_VALUE_HINT}`;
};
