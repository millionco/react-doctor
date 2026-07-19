// rule: nextjs-async-dynamic-api-not-awaited
// weakness: alias-guard
// source: PR #1000 independent audit

import { cookies } from "next/headers";

const settleMethod = "then";

export const readSession = () => cookies()[settleMethod]((store) => store.get("session"));
