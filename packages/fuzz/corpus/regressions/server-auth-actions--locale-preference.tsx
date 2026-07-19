// rule: server-auth-actions
// weakness: library-idiom
// source: JOYCEQL/magic-resume src/components/shared/UpdateLocale.tsx

"use server";

import { setUserLocale } from "@/i18n/db";
import { revalidatePath } from "next/cache";

export default async function updateLocale(locale: string) {
  setUserLocale(locale);
  revalidatePath("/");
}
