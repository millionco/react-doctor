import { isEvalExpression } from "./is-eval-expression.js";

export interface PlaywrightTestInput {
  // The page the session is on when codegen runs — the test navigates here first.
  url: string;
  // The `eval` expression, verified by running it, that becomes the test's action.
  expression: string;
  // Test title; derived from the URL path when omitted.
  name?: string;
}

// Turn a verified `browser eval` expression into a runnable Playwright spec: the
// session's current URL becomes the navigation, the expression becomes the
// action, and the page is asserted to fire no console / page errors — the same
// signal `eval` already reports, now a regression guard.
export const generatePlaywrightTest = ({ url, expression, name }: PlaywrightTestInput): string =>
  `import { expect, test } from "@playwright/test";

test(${JSON.stringify(name ?? deriveTestName(url))}, async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(${JSON.stringify(url)});
${formatAction(expression)}

  expect(pageErrors, pageErrors.join("\\n")).toEqual([]);
});
`;

// A bare expression (`page.getByRole(...).click()`) is awaited; multi-statement
// source is inlined as-is so its own awaits and declarations stand.
const formatAction = (expression: string): string => {
  const trimmed = expression.trim();
  const lines = isEvalExpression(trimmed) ? [`await ${trimmed};`] : trimmed.split("\n");
  return lines.map((line) => `  ${line}`).join("\n");
};

const deriveTestName = (url: string): string => {
  try {
    const { pathname } = new URL(url);
    return `eval on ${pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return "eval interaction";
  }
};
