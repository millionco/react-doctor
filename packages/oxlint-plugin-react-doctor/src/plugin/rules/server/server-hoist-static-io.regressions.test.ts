import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverHoistStaticIo } from "./server-hoist-static-io.js";

describe("server/server-hoist-static-io — regressions", () => {
  it("does not flag a read whose path depends on a destructured route param", () => {
    const result = runRule(
      serverHoistStaticIo,
      'export async function GET(request, { params }){ const data = await readFile(`./content/${params.slug}.md`, "utf8"); return Response.json(data); }',
      { filename: "app/content/[slug]/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a static literal-path read with no handler-arg dependency", () => {
    const result = runRule(
      serverHoistStaticIo,
      'export async function GET(request){ const data = await readFile("./content/home.md", "utf8"); return Response.json(data); }',
      { filename: "app/content/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
