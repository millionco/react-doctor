// HACK: react-doctor reads the project's React version straight out of
// package.json, which produces semver ranges (`^19.0.0`, `~18.3.1`,
// `>=18 <20`, `19.x`, `latest`, etc.) — never a normalized number. The
// rule registry needs an integer major to gate React-19-only rules
// (e.g. `no-react19-deprecated-apis`, `no-default-props`) without
// false-positive flagging on React 17 / 18 codebases.
//
// We grab the FIRST integer that appears anywhere in the version
// string, which gives the right answer for every shape we see in
// practice:
//   "19.0.0" → 19, "^18.3.1" → 18, "~17.0.2" → 17, ">=18 <20" → 18,
//   "19.x" → 19, "workspace:*" → null, "*" → null, "" → null, null → null.
//
// Returning `null` for tags ("latest", "next"), workspace protocols,
// and ranges that don't carry a concrete lower bound is intentional:
// callers should treat `null` as "unknown — leave version-gated rules
// enabled" so we never silently disable migration help for a project
// we couldn't classify.
export const parseReactMajor = (reactVersion: string | null | undefined): number | null => {
  if (typeof reactVersion !== "string") return null;
  const trimmed = reactVersion.trim();
  if (trimmed.length === 0) return null;
  const match = trimmed.match(/(\d+)/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  // HACK: React publishes experimental / canary builds as
  // `0.0.0-experimental-<sha>` to keep stable consumers safe. The
  // first-integer scan would land on `0`, which is then `< 18` and
  // silently disables every version-gated rule. Reject `0` → null so
  // the "unknown major" branch leaves migration rules enabled (no
  // realistic React project ships a true major-0 release we'd need to
  // distinguish — anything pre-1 predates the React rewrite by years).
  if (!Number.isFinite(major) || major <= 0) return null;
  return major;
};
