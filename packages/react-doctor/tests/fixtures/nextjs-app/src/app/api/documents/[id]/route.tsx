import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

declare const v2GET: (req: NextRequest, ctx: RouteContext) => Promise<Response>;

// Verbatim repro from issue #206 — used to flood codebases with false
// positives. Response header shaping must not fire the rule.
export async function GET(req: NextRequest, ctx: RouteContext) {
  const res = await v2GET(req, ctx);
  res.headers.set("X-Deprecated", "Use /api/v2/documents/[id]");
  res.headers.append("Vary", "Cookie");
  res.headers.delete("X-Cache");

  const customHeaders = new Headers();
  customHeaders.set("Content-Type", "application/json");
  customHeaders.append("X-Trace", "abc");
  customHeaders.delete("X-Internal");

  const lookup = new Map<string, string>();
  lookup.set("id", "value");

  const seen = new Set<string>();
  seen.add("id");

  const params = new URL(req.url).searchParams;
  params.set("limit", "10");

  const formData = new FormData();
  formData.set("file", "blob");

  const response = NextResponse.json({ ok: true });
  response.headers.set("X-Trace", "abc");

  const readonly = await headers();
  readonly.get("user-agent");

  return NextResponse.json({ ok: true }).headers ? NextResponse.json({ ok: true }) : response;
}
