import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsGlobalErrorMissingHtmlBody } from "./nextjs-global-error-missing-html-body.js";

describe("nextjs/nextjs-global-error-missing-html-body — regressions", () => {
  it("flags a global-error.tsx without <html>/<body>", () => {
    const result = runRule(
      nextjsGlobalErrorMissingHtmlBody,
      `export default function GlobalError({ error }) {
        return <div>{String(error)}</div>;
      }`,
      { filename: "/proj/app/global-error.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("<html>");
  });

  it("stays silent when the error UI is wrapped in <html><body>", () => {
    const result = runRule(
      nextjsGlobalErrorMissingHtmlBody,
      `export default function GlobalError({ error }) {
        return (
          <html>
            <body>
              <div>{String(error)}</div>
            </body>
          </html>
        );
      }`,
      { filename: "/proj/app/global-error.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on files outside the app directory", () => {
    const result = runRule(
      nextjsGlobalErrorMissingHtmlBody,
      `export default function GlobalError({ error }) {
        return <div>{String(error)}</div>;
      }`,
      { filename: "/proj/src/global-error.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
