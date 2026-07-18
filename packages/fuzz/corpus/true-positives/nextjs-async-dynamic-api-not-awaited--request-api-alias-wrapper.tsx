// rule: nextjs-async-dynamic-api-not-awaited
// weakness: aliasing
// source: PR #1000 independent audit

import { cookies, draftMode } from "next/headers";

const readCookies = cookies;
const readDraftMode = () => draftMode();

export const readSession = () => readCookies().get("session");
export const readDraftStatus = () => readDraftMode().isEnabled;
