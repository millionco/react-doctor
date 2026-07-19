// rule: nextjs-async-dynamic-api-not-awaited
// weakness: alias-guard
// source: PR #1000 deep audit

import { cookies, type UnsafeUnwrappedCookies } from "next/headers";

type LegacyCookieStore = UnsafeUnwrappedCookies;

export const readSession = () => (cookies() as unknown as LegacyCookieStore).get("session");
