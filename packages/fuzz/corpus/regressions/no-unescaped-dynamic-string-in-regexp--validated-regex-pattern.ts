// rule: no-unescaped-dynamic-string-in-regexp
// weakness: control-flow
// source: local RDE validation (PostHog path cleaning filters)
import { isValidRegexp } from "lib/utils/regexp";

export const cleanPath = (path: string, filter: { regex?: string }): string => {
  if (!isValidRegexp(filter.regex ?? "")) return path;
  return path.replace(new RegExp(filter.regex ?? "", "gi"), "");
};
