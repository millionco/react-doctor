import { cookies } from "next/headers";
import { NextResponse } from "next/server";

declare const db: {
  update: (table: unknown) => { set: (values: unknown) => { where: (cond: unknown) => unknown } };
  insert: (values: unknown) => unknown;
};
declare const usersTable: unknown;
declare const eq: (a: unknown, b: unknown) => unknown;

// Module-level cache — mutating it from a GET handler IS a real
// side effect (server state leaks across requests).
const cache = new Map<string, unknown>();

export async function GET() {
  cache.set("hit", Date.now());
  db.update(usersTable).set({ active: false }).where(eq("id", 1));
  await fetch("/api/notify", { method: "POST", body: "x" });
  const cookieHandler = await cookies();
  cookieHandler.set("session", "token");
  return NextResponse.json({ ok: true });
}
