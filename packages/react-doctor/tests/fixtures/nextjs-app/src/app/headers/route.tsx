import { NextResponse } from "next/server";

export async function GET() {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  response.headers.append("Vary", "Accept");
  response.headers.delete("X-Deprecated");

  const headers = new Headers();
  headers.set("X-Route", "headers");

  const requestScope = new Map<string, string>();
  requestScope.set("seen", "true");

  return response;
}
