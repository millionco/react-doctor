"use server";

let requestCount = 0;

export async function createUser(formData: FormData) {
  requestCount += 1;
  const name = formData.get("name");
  console.log("Creating user:", name);
  return { success: true, requestCount };
}

export async function deleteUser(userId: string) {
  console.log("Deleting user:", userId);
  return { success: true };
}
