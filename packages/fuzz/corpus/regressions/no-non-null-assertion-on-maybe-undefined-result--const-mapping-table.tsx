// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (cloudscape breakpoints: exhaustive const array-literal mapping table cannot miss a union-typed key)
type Breakpoint = "default" | "xxs" | "xs" | "s" | "m" | "l" | "xl";

const BREAKPOINT_MAPPING: [Breakpoint, number][] = [
  ["xl", 1840],
  ["l", 1320],
  ["m", 1120],
  ["s", 912],
  ["xs", 688],
  ["xxs", 465],
  ["default", -1],
];

export function getBreakpointValue(breakpoint: Breakpoint): number {
  return BREAKPOINT_MAPPING.find((bp) => bp[0] === breakpoint)![1];
}
