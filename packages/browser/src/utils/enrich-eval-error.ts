// Page globals that don't exist in the Node scope `eval` runs in. Reaching for
// one is the classic mistake — writing page-context code directly instead of
// inside `page.evaluate(() => ...)` — so turn the bare ReferenceError into that
// fix rather than leaving the agent to guess.
const PAGE_GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "location",
];

export const enrichEvalError = (error: unknown): unknown => {
  if (!(error instanceof ReferenceError)) return error;
  const culprit = PAGE_GLOBALS.find((name) => error.message.includes(`${name} is not defined`));
  if (!culprit) return error;
  error.message = `${error.message}\n\`eval\` runs in Node with the Playwright \`page\` in scope, not in the page. Reach page globals through it: page.evaluate(() => ${culprit}...).`;
  return error;
};
