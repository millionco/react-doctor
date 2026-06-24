import type { Page } from "playwright-core";

export interface CompiledEval<T> {
  (page: Page): Promise<T>;
}

// `eval` source runs in Node with the Playwright `page` in scope. A bare
// expression — `page.getByText("Login").click()` — is the common case, so
// compile that first to keep its return value. Multi-statement source, or a
// body that uses `return`, isn't a valid expression and throws a SyntaxError at
// construction; recompile it as a function body so both shapes work without the
// caller hand-wrapping an async IIFE.
export const compileEval = <T>(expression: string): CompiledEval<T> => {
  try {
    return new Function(
      "page",
      `"use strict"; return (async () => (${expression}))();`,
    ) as CompiledEval<T>;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return new Function(
      "page",
      `"use strict"; return (async () => { ${expression} })();`,
    ) as CompiledEval<T>;
  }
};
