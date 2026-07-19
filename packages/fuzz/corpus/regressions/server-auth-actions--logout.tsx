// rule: server-auth-actions
// weakness: name-heuristic
// source: it-incubator/musicfun logout.action.tsx, React Doctor Daytona eval 2026-07-19

"use server";

import { cookies } from "next/headers";

export const logout = async () => {
  const cookieStore = await cookies();
  cookieStore.delete("accessToken");
  cookieStore.delete("refreshToken");
};
