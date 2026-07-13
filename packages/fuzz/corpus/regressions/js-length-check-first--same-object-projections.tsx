// rule: js-length-check-first
// weakness: other
// source: ISSUES_TO_FIX_ASAP.md same-object key/value projection report

const defaultBindings = Object.freeze({ next: "j", previous: "k" });

export const hasCompleteBindings = (bindings: Record<string, unknown>): boolean =>
  Object.values(defaultBindings).every((_, index) => {
    const key = Object.keys(defaultBindings)[index];
    return typeof bindings[key] === "string";
  });
