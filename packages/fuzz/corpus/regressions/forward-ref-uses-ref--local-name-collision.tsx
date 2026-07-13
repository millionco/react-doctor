// rule: forward-ref-uses-ref
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md V25 binding-provenance report
const forwardRef = (transform: (value: string) => string): string => transform("hello");

export const transformedValue = forwardRef((value) => value.toUpperCase());
