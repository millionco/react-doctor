"use server";

import { cache } from "react";

const analytics = {
  track: (_event: string, _props?: Record<string, unknown>) => {},
};

let requestCount = 0;
const userCache = new Map<string, { name: string }>();
void userCache;

const getUser = cache(async (params: { uid: number }) => {
  return { uid: params.uid, name: "Anon" };
});

export async function createUser(formData: FormData) {
  requestCount += 1;
  const name = formData.get("name");
  // Both of these MUST fire `server-after-nonblocking`: console.log
  // because the rule treats it as a deferrable side effect (history),
  // and analytics.track because it's a known SDK network round trip.
  console.log("Creating user:", name);
  analytics.track("user-created", { name });
  // server-cache-with-object-literal: fresh {} per call defeats cache().
  await getUser({ uid: 1 });
  await getUser({ uid: 1 });
  return { success: true, requestCount };
}

export async function deleteUser(userId: string) {
  console.log("Deleting user:", userId);
  return { success: true };
}
