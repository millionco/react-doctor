import { cliLogger as logger } from "./cli-logger.js";
import type { InspectFlags } from "./inspect-flags.js";
import { buildRuleCatalog, listRuleTags } from "./rule-catalog.js";

// `--ignore-tag <tag>` is validated warn-only (unlike `rules ignore-tag`,
// which hard-errors): CI harnesses drive it across version skew, so an
// unknown tag no-ops with a nudge rather than failing the scan. Routed
// through cliLogger so it's suppressed in JSON / silent mode.
export const warnUnknownIgnoreTags = (flags: InspectFlags): void => {
  if (!flags.ignoreTag || flags.ignoreTag.length === 0) return;
  const knownTags = new Set(listRuleTags(buildRuleCatalog()));
  const unknown = [...new Set(flags.ignoreTag)].filter((tag) => !knownTags.has(tag));
  if (unknown.length === 0) return;
  logger.warn(
    `Ignoring unknown --ignore-tag value${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")} (no rule carries ${unknown.length > 1 ? "them" : "it"}).`,
  );
};
