/**
 * Regression tests for `nextjs-no-side-effect-in-get-handler` — issue #206.
 *
 * The rule used to treat ANY `<member>.<set|append|delete|create|insert|
 * update|upsert|remove|destroy>()` call as a server-state mutation. In a
 * Next.js 14 codebase that flooded `src/app/api/**\/route.ts` with 138
 * false-positive errors, every single one a `response.headers.set(...)`
 * response-shaping call.
 *
 * This file pins down:
 *   - 13 false-negative shapes that must produce ZERO hits (the headers /
 *     local-Map / cron-route / aliased-`headers()` cases),
 *   - 9 true-positive shapes that MUST still fire (drizzle, module-level
 *     caches, aliased `cookies()`, mutating fetch),
 *   - a 138x stress test that mirrors the original issue.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import type { Diagnostic, ProjectInfo } from "@react-doctor/types";
import { buildTestProject, setupReactProject, writeFile } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-nextjs-get-side-effects-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const RULE_NAME = "nextjs-no-side-effect-in-get-handler";

const buildNextjsProject = (caseId: string): { rootDirectory: string; project: ProjectInfo } => {
  const rootDirectory = setupReactProject(tempRoot, caseId);
  return {
    rootDirectory,
    project: buildTestProject({ rootDirectory, framework: "nextjs" }),
  };
};

const writeRouteAndLint = async (
  caseId: string,
  routePath: string,
  routeSource: string,
): Promise<Diagnostic[]> => {
  const { rootDirectory, project } = buildNextjsProject(caseId);
  writeFile(path.join(rootDirectory, routePath), routeSource);
  return runOxlint({ rootDirectory, project });
};

const filterRule = (diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.rule === RULE_NAME);

describe("issue #206: nextjs-no-side-effect-in-get-handler false positives", () => {
  describe("does NOT fire on", () => {
    it("the verbatim repro: `res.headers.set('X-Deprecated', ...)`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-verbatim",
        "src/app/api/documents/[id]/route.ts",
        `import type { NextRequest } from "next/server";

interface RouteContext { params: Promise<{ id: string }> }
declare const v2GET: (req: NextRequest, ctx: RouteContext) => Promise<Response>;

export async function GET(req: NextRequest, ctx: RouteContext) {
  const res = await v2GET(req, ctx);
  res.headers.set("X-Deprecated", "Use /api/v2/documents/[id]");
  return res;
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("response.headers.append + response.headers.delete", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-append-delete",
        "src/app/api/orders/route.ts",
        `import { NextResponse } from "next/server";

declare const upstream: () => Promise<Response>;

export async function GET() {
  const response = await upstream();
  response.headers.append("Vary", "Cookie");
  response.headers.delete("X-Cache");
  return response ?? NextResponse.json({ ok: true });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("chained NextResponse.json({...}).headers.set(...)", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-chained-nextresponse",
        "src/app/api/health/route.ts",
        `import { NextResponse } from "next/server";

export async function GET() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "public, max-age=60");
  return response;
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("locally-constructed `new Headers()` and `.set/.append/.delete`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-local-headers",
        "src/app/api/headers/route.ts",
        `import { NextResponse } from "next/server";

export async function GET() {
  const customHeaders = new Headers();
  customHeaders.set("x", "1");
  customHeaders.append("y", "2");
  customHeaders.delete("z");
  return new NextResponse(null, { headers: customHeaders });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("locally-constructed `new Map()` and `new Set()`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-local-map-set",
        "src/app/api/dedupe/route.ts",
        `import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const cache = new Map<string, string>();
  cache.set(req.url, "hit");
  const seen = new Set<string>();
  seen.add(req.url);
  return NextResponse.json({ ok: true });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("`new URL(...).searchParams.set(...)`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-search-params",
        "src/app/api/search/route.ts",
        `import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  params.set("limit", "10");
  return NextResponse.json({ params: params.toString() });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("locally-constructed `new URLSearchParams()` and `.append`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-urlsearchparams",
        "src/app/api/qs/route.ts",
        `import { NextResponse } from "next/server";

export async function GET() {
  const params = new URLSearchParams();
  params.append("q", "next");
  return NextResponse.json({ qs: params.toString() });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("locally-constructed `new FormData()` and `.set`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-formdata",
        "src/app/api/upload/route.ts",
        `import { NextResponse } from "next/server";

export async function GET() {
  const formData = new FormData();
  formData.set("file", "blob");
  return NextResponse.json({ size: formData.has("file") });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("`const response = NextResponse.json(...); response.headers.set(...)`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-response-alias",
        "src/app/api/trace/route.ts",
        `import { NextResponse } from "next/server";

declare const traceId: string;

export async function GET() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("X-Trace", traceId);
  return response;
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("`const response = new NextResponse(stream); response.headers.set(...)`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-new-nextresponse",
        "src/app/api/stream/route.ts",
        `import { NextResponse } from "next/server";

declare const stream: ReadableStream;

export async function GET() {
  const response = new NextResponse(stream);
  response.headers.set("Content-Type", "text/event-stream");
  return response;
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("`headers().set(...)` and `(await headers()).set(...)` (ReadonlyHeaders — would throw, never a server-state write)", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-readonly-headers",
        "src/app/api/echo/route.ts",
        `import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  headers().set("x", "y");
  (await headers()).set("a", "b");
  return NextResponse.json({ ok: true });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("aliased read-only `headers()` — `const h = headers(); h.get('user-agent')`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-headers-alias-read",
        "src/app/api/ua/route.ts",
        `import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const h = headers();
  const userAgent = h.get("user-agent");
  return NextResponse.json({ userAgent });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("cron route handler with a real `db.insert(...)` is skipped via CRON_ROUTE_PATTERN", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-cron-skip",
        "src/app/api/cron/refresh/route.ts",
        `import { NextResponse } from "next/server";

declare const db: { insert: (values: unknown) => Promise<unknown> };

export async function GET() {
  await db.insert({ refreshedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });
  });

  describe("DOES still fire on", () => {
    it("drizzle `db.update(table).set({...}).where(...)` from the @Sparticuz comment", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-drizzle",
        "src/app/api/users/route.ts",
        `import { NextResponse } from "next/server";

declare const db: { update: (t: unknown) => { set: (v: unknown) => { where: (c: unknown) => unknown } } };
declare const usersTable: unknown;
declare const eq: (a: unknown, b: unknown) => unknown;

export async function GET() {
  db.update(usersTable).set({ active: false }).where(eq("id", 1));
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain(".set()");
    });

    it("`prisma.user.create({...})`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-prisma-create",
        "src/app/api/signup/route.ts",
        `import { NextResponse } from "next/server";

declare const prisma: { user: { create: (args: unknown) => Promise<unknown> } };

export async function GET() {
  await prisma.user.create({ data: { name: "x" } });
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain(".create()");
    });

    it("module-level `const cache = new Map()` mutated from inside the handler", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-module-cache",
        "src/app/api/track/route.ts",
        `import { NextResponse } from "next/server";

const cache = new Map<string, number>();

export async function GET(req: Request) {
  cache.set(req.url, Date.now());
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("cache.set()");
    });

    it("mutating `fetch('/api/notify', { method: 'POST' })`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-fetch-post",
        "src/app/api/notify/route.ts",
        `import { NextResponse } from "next/server";

export async function GET() {
  await fetch("/api/notify", { method: "POST", body: "x" });
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("fetch() with method POST");
    });

    it("direct `cookies().set('session', token, ...)`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-cookies-set",
        "src/app/api/login/route.ts",
        `import { cookies } from "next/headers";
import { NextResponse } from "next/server";

declare const token: string;

export async function GET() {
  cookies().set("session", token, { httpOnly: true });
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("cookies().set()");
    });

    it("`(await cookies()).delete('session')` (Next.js 15 async form)", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-cookies-await-delete",
        "src/app/api/end-session/route.ts",
        `import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  (await cookies()).delete("session");
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("cookies().delete()");
    });

    it("aliased cookies (sync): `const cookieHandler = cookies(); cookieHandler.set('a', 'b')`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-cookies-alias-sync",
        "src/app/api/bookmark/route.ts",
        `import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieHandler = cookies();
  cookieHandler.set("a", "b");
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("cookies().set()");
    });

    it("aliased cookies (async): `const cs = await cookies(); cs.delete('session')`", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-cookies-alias-async",
        "src/app/api/clear/route.ts",
        `import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cs = await cookies();
  cs.delete("session");
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("cookies().delete()");
    });

    it("mutating route segment `/logout` still fires on its own", async () => {
      const diagnostics = await writeRouteAndLint(
        "issue-206-mutating-segment",
        "src/app/logout/route.ts",
        `import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("/logout");
    });
  });

  describe("stress: synthesised 138x response.headers.set codebase", () => {
    it("produces 0 hits across 138 route files (was 138 in the original report)", async () => {
      const { rootDirectory, project } = buildNextjsProject("issue-206-138x-stress");

      const ROUTE_COUNT = 138;
      for (let routeIndex = 0; routeIndex < ROUTE_COUNT; routeIndex++) {
        const routeSource = `import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

interface RouteContext { params: Promise<{ id: string }> }
declare const v2GET${routeIndex}: (req: NextRequest, ctx: RouteContext) => Promise<Response>;

export async function GET(req: NextRequest, ctx: RouteContext) {
  const res = await v2GET${routeIndex}(req, ctx);
  res.headers.set("X-Deprecated", "Use /api/v2/route-${routeIndex}");
  return res ?? NextResponse.json({ ok: true });
}
`;
        writeFile(
          path.join(rootDirectory, `src/app/api/route-${routeIndex}/route.ts`),
          routeSource,
        );
      }

      const diagnostics = await runOxlint({ rootDirectory, project });
      expect(filterRule(diagnostics)).toHaveLength(0);
    });
  });
});
