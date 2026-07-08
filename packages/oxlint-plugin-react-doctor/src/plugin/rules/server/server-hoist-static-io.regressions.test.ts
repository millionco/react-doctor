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

  it("does not flag a read whose path derives from a param through intermediate bindings", () => {
    const result = runRule(
      serverHoistStaticIo,
      `export async function GET(request, { params }) {
        const { path: pathArray } = await params;
        const filePath = pathArray.join("/");
        const fullPath = path.join(process.cwd(), "openapi", filePath);
        const fileContent = await readFile(fullPath, "utf8");
        return Response.json(fileContent);
      }`,
      { filename: "app/openapi/[...path]/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag readdir in a handler that writes and unlinks files in the same directory", () => {
    const result = runRule(
      serverHoistStaticIo,
      `export async function POST(request) {
        const dir = getBrandingDir();
        const allFiles = await readdir(dir).catch(() => []);
        for (const f of allFiles) {
          try { await unlink(path.join(dir, f)); } catch {}
        }
        const buffer = Buffer.from(await request.arrayBuffer());
        await writeFile(path.join(dir, "asset.png"), buffer);
        return Response.json({ ok: true });
      }`,
      { filename: "app/api/admin/branding/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag readdir in a DELETE handler that unlinks listed files", () => {
    const result = runRule(
      serverHoistStaticIo,
      `export async function DELETE(request) {
        const dir = getBrandingDir();
        const allFiles = await readdir(dir).catch(() => []);
        for (const f of allFiles) {
          try { await unlink(path.join(dir, f)); } catch {}
        }
        return Response.json({ success: true });
      }`,
      { filename: "app/api/admin/branding/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags readdir in a read-only handler", () => {
    const result = runRule(
      serverHoistStaticIo,
      `export async function GET(request) {
        const entries = await readdir("./content");
        return Response.json(entries);
      }`,
      { filename: "app/content/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a static readFile in a handler that mutates unrelated files", () => {
    const result = runRule(
      serverHoistStaticIo,
      `export async function POST(request) {
        const font = await readFile("./fonts/Inter.ttf");
        await writeFile("./out/render.png", font);
        return new Response(font);
      }`,
      { filename: "app/og/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a read through an intermediate binding that never touches a param", () => {
    const result = runRule(
      serverHoistStaticIo,
      `export async function GET(request) {
        const fontPath = path.join(process.cwd(), "fonts", "Inter.ttf");
        const data = await readFile(fontPath);
        return new Response(data);
      }`,
      { filename: "app/og/route.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
