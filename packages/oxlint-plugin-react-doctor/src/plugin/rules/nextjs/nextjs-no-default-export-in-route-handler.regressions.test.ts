import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoDefaultExportInRouteHandler } from "./nextjs-no-default-export-in-route-handler.js";

describe("nextjs/nextjs-no-default-export-in-route-handler — regressions", () => {
  it("flags a default export in an App Router route.ts", () => {
    const result = runRule(
      nextjsNoDefaultExportInRouteHandler,
      `export default function handler(req, res) {
        res.json({ ok: true });
      }`,
      { filename: "/proj/app/api/hello/route.ts" },
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("named HTTP method exports");
  });

  it("stays silent when named HTTP method exports are present", () => {
    const result = runRule(
      nextjsNoDefaultExportInRouteHandler,
      `export const GET = () => Response.json({ ok: true });
      const helpers = { ok: true };
      export default helpers;`,
      { filename: "/proj/app/api/hello/route.ts" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on default exports outside route handler files", () => {
    const result = runRule(
      nextjsNoDefaultExportInRouteHandler,
      `export default function Page() {
        return null;
      }`,
      { filename: "/proj/app/page.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
