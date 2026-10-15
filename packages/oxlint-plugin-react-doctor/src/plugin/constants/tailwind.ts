export const TAILWIND_NAMED_BREAKPOINTS: ReadonlyArray<string> = ["sm", "md", "lg", "xl", "2xl"];
export const TAILWIND_BREAKPOINT_NAMES: ReadonlyArray<string> = ["", ...TAILWIND_NAMED_BREAKPOINTS];
export const TAILWIND_BREAKPOINT_RANKS: ReadonlyMap<string, number> = new Map(
  TAILWIND_NAMED_BREAKPOINTS.map((breakpointName, breakpointIndex) => [
    breakpointName,
    breakpointIndex,
  ]),
);

export const CLOSED_CLASS_TEMPLATE_EXPRESSION_COUNT = 1;
export const CLOSED_CLASS_TEMPLATE_QUASI_COUNT = 2;
