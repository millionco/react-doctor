import { NextResponse } from "next/server";

declare const db: {
  user: { findUnique: (q: { where: { id: number } }) => Promise<unknown> };
  posts: { findMany: () => Promise<unknown[]> };
};

// server-sequential-independent-await: two consecutive awaits with no
// data dependency on the first.
export async function GET() {
  const user = await db.user.findUnique({ where: { id: 1 } });
  const posts = await db.posts.findMany();
  return NextResponse.json({ user, posts });
}
