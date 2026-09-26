// rule: server-sequential-independent-await
// verdict: fail
// weakness: alias-guard
// source: cached-async-work distinct imported requests sharing a stable argument
import { getUser, getPermissions } from "./requests";

export const load = async (userId: string) => {
  const user = await getUser(userId);
  const permissions = await getPermissions(userId);
  return [user, permissions];
};
