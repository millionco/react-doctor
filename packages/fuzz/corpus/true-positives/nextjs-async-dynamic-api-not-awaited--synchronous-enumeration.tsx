// rule: nextjs-async-dynamic-api-not-awaited
// weakness: wrapper-transparency
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const listCookieProperties = () => Object.keys(cookies());
