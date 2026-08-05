const COMPARISON_MEMOIZER_HOOK_NAME_PATTERN = /^use(?:Deep|Shallow)?CompareMemo(?:ize|izedValue)?$/;

export const isComparisonMemoizerHookName = (hookName: string): boolean =>
  COMPARISON_MEMOIZER_HOOK_NAME_PATTERN.test(hookName);
