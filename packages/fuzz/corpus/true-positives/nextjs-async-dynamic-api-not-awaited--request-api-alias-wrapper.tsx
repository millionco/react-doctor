// rule: nextjs-async-dynamic-api-not-awaited
// weakness: wrapper-transparency
// source: PR #1000 independent audit

import { cookies, draftMode } from "next/headers";
import * as nextHeaders from "next/headers";

const readCookies = cookies;
const readHeaders = nextHeaders.headers;
const readDraftMode = () => draftMode();

export const readSession = () => readCookies().get("session");
export const readRequestId = () => readHeaders().get("x-request-id");
export const readDraftStatus = () => readDraftMode().isEnabled;
