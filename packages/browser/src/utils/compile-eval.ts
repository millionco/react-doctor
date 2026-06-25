import type { Page } from "playwright-core";
import { isEvalExpression } from "./is-eval-expression.js";

export interface CompiledEval<T> {
  (page: Page): Promise<T>;
}

// `eval` source runs in Node with the Playwright `page` in scope. A bare
// expression is the common case, so compile that first to keep its return value;
// multi-statement source is recompiled as a function body, so both shapes work
// without the caller hand-wrapping an async IIFE.
export const compileEval = <T>(expression: string): CompiledEval<T> => {
  const body = isEvalExpression(expression)
    ? `"use strict"; return (async () => (${expression}))();`
    : `"use strict"; return (async () => { ${expression} })();`;
  return new Function("page", body) as CompiledEval<T>;
};
