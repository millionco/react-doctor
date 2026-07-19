// rule: nextjs-async-dynamic-api-not-awaited
// weakness: wrapper-transparency
// source: PR #1000 deep audit

import { cookies, type UnsafeUnwrappedCookies as LegacyCookieStore } from "next/headers";

export const readSession = () => (cookies() as unknown as LegacyCookieStore).get("session");
