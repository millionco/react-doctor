export const usedFunction = () => ({ value: 42 });

export const unusedFunction = () => "not used anywhere";

export function anotherUnused(): void {
  // This function is exported but never imported
}

/** @public */
export function publicApiFunction(): string {
  // This function is not imported by any file in the project,
  // but it has @public so it should NOT be reported as unused.
  return "public API";
}
