"use server";

import { cache } from "react";

let requestCount = 0;

const getUser = cache(async (params: { uid: number }) => {
  return { uid: params.uid, name: "Anon" };
});

export async function createUser(formData: FormData) {
  requestCount += 1;
  const name = formData.get("name");
  console.log("Creating user:", name);
  // server-cache-with-object-literal: fresh {} per call defeats cache().
  await getUser({ uid: 1 });
  await getUser({ uid: 1 });
  return { success: true, requestCount };
}

export async function deleteUser(userId: string) {
  console.log("Deleting user:", userId);
  return { success: true };
}
