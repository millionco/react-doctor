import type { GroupStats } from "./types.js";

/**
 * The bare model name for a leaderboard row — strips the `provider/` prefix that
 * keys model groups, so `claude/claude-sonnet-4-5` reads as `claude-sonnet-4-5`.
 * Provider groups (whose key is just the provider) pass through unchanged.
 */
export const modelLabel = (group: GroupStats): string => {
  const slash = group.key.indexOf("/");
  return slash === -1 ? group.key : group.key.slice(slash + 1);
};
