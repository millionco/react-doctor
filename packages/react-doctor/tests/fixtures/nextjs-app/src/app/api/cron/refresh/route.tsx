import { NextResponse } from "next/server";

declare const db: {
  insert: (values: unknown) => Promise<unknown>;
};

// Vercel Cron always invokes GET — real side effects are expected
// and the rule must not fire here.
export async function GET() {
  await db.insert({ refreshedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
