// Whether `eval` source is a single expression (`page.getByText("Login")
// .click()`) rather than multi-statement source or a body using `return`. The
// expression wrap throws a SyntaxError at construction when the source isn't one,
// which is exactly the signal — a non-syntax failure means it did parse.
export const isEvalExpression = (expression: string): boolean => {
  try {
    new Function("page", `"use strict"; return (async () => (${expression}))();`);
    return true;
  } catch (error) {
    return !(error instanceof SyntaxError);
  }
};
