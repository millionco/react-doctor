// rule: no-prop-types
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md V27 component receiver provenance report

export const Schema = { propTypes: {} as Record<string, (value: unknown) => boolean> };
Schema.propTypes = { value: (value: unknown): boolean => typeof value === "string" };
