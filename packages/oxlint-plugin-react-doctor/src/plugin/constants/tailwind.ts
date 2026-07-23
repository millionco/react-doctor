export const TAILWIND_NAMED_BREAKPOINTS: ReadonlyArray<string> = ["sm", "md", "lg", "xl", "2xl"];
export const TAILWIND_BREAKPOINT_NAMES: ReadonlyArray<string> = ["", ...TAILWIND_NAMED_BREAKPOINTS];
export const TAILWIND_BREAKPOINT_RANKS: ReadonlyMap<string, number> = new Map(
  TAILWIND_NAMED_BREAKPOINTS.map((breakpointName, breakpointIndex) => [
    breakpointName,
    breakpointIndex,
  ]),
);
