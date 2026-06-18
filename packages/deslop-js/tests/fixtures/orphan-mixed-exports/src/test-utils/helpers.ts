// Both exports are unreachable from the entry point.
// usedHelper is imported by setup.ts (also unreachable) — should still be flagged.
// unusedHelper is not imported by anyone — should be flagged.

export const usedHelper = (): string => "used";

export const unusedHelper = (): string => "unused";
