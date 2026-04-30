import fs from "node:fs";
import { NextResponse } from "next/server";

// server-hoist-static-io: fs.readFileSync inside route handler.
export async function GET(request: Request) {
  const fontData = fs.readFileSync("./fonts/Inter.ttf");
  // Also flag fetch(new URL(..., import.meta.url)).
  const cssAsset = await fetch(new URL("./styles.css", import.meta.url)).then((r) => r.text());
  const url = new URL(request.url);
  return NextResponse.json({
    bytes: fontData.byteLength,
    css: cssAsset.length,
    path: url.pathname,
  });
}
