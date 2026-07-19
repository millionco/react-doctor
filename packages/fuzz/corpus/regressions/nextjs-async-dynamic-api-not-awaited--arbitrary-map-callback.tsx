// rule: nextjs-async-dynamic-api-not-awaited
// weakness: library-idiom
// source: PR #1000 independent audit

import { cookies } from "next/headers";

export const scheduleRead = async (scheduler: {
  flush: () => void;
  map: (callback: () => unknown) => void;
}) => {
  let pendingCookies = cookies();
  scheduler.map(() => pendingCookies.get("session"));
  pendingCookies = await pendingCookies;
  scheduler.flush();
};
