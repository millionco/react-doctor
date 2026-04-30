import { NextResponse } from "next/server";

declare const db: {
  user: { findUnique: (q: { where: { id: number } }) => Promise<unknown> };
  posts: { findMany: () => Promise<unknown[]> };
};

// server-sequential-independent-await: two consecutive awaits with no
// data dependency on the first.
// server-fetch-without-revalidate: fetch without next.revalidate option.
export async function GET() {
  const user = await db.user.findUnique({ where: { id: 1 } });
  const posts = await db.posts.findMany();
  const profile = await fetch("https://api.example.com/profile");
  return NextResponse.json({ user, posts, profile: await profile.json() });
}
