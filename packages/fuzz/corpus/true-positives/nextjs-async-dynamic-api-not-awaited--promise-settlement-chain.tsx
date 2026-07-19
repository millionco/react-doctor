// rule: nextjs-async-dynamic-api-not-awaited
// weakness: copy-tracking
// source: PR #1000 deep audit

import { cookies } from "next/headers";

export const readSession = () =>
  cookies()
    .catch(() => cookies())
    .get("session");
