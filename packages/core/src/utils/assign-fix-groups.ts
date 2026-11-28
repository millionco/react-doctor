import { createHash } from "node:crypto";
import {
  FIX_GROUP_ID_LENGTH_CHARS,
  MIN_SHARED_FIX_SITE_COUNT,
  ROOT_CAUSE_GROUPABLE_RULE_KEYS,
} from "../constants.js";
import type { Diagnostic } from "../types/index.js";
import { collectExactPropResetGroups } from "./collect-exact-prop-reset-groups.js";
import { stripPropResetGroupContext } from "./strip-prop-reset-group-context.js";

// Stable, content-derived id for the root-cause group a finding belongs to.
// Exact prop resets are keyed by the owning effect. Other groupable
// findings use the existing file, rule and message identity.
// The fields are JSON-encoded before hashing so no manual delimiter can let one
// field's tail alias the next; sha1 keeps the id stable across runs, matching
// `buildDiagnosticIdentity`'s content-keyed philosophy.
const buildFixGroupId = (diagnostic: Diagnostic, exactRoot?: string): string =>
  createHash("sha1")
    .update(
      JSON.stringify([
        diagnostic.filePath,
        `${diagnostic.plugin}/${diagnostic.rule}`,
        diagnostic.message,
        ...(exactRoot !== undefined ? [exactRoot, diagnostic.offset, diagnostic.length] : []),
      ]),
    )
    .digest("hex")
    .slice(0, FIX_GROUP_ID_LENGTH_CHARS);

const isGroupableRule = (diagnostic: Diagnostic): boolean =>
  ROOT_CAUSE_GROUPABLE_RULE_KEYS.has(`${diagnostic.plugin}/${diagnostic.rule}`);

// Stamps a shared `fixGroupId` on findings that one fix resolves together, so
// a consumer that turns findings into tasks counts a single root cause as one
// task rather than N. Complete prop resets share an ID with their exact setter
// findings. Other groupable findings use the file, rule and message fallback.
export const assignFixGroups = (
  diagnostics: ReadonlyArray<Diagnostic>,
  rootDirectory = "",
): Diagnostic[] => {
  const exactResetGroups = collectExactPropResetGroups(diagnostics);
  const siteCountByGroupId = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    if (exactResetGroups.has(diagnostic) || !isGroupableRule(diagnostic)) continue;
    const groupId = buildFixGroupId(diagnostic);
    siteCountByGroupId.set(groupId, (siteCountByGroupId.get(groupId) ?? 0) + 1);
  }

  return diagnostics.map((diagnostic) => {
    const exactOwner = exactResetGroups.get(diagnostic);
    const result = stripPropResetGroupContext(diagnostic);
    if (exactOwner) return { ...result, fixGroupId: buildFixGroupId(exactOwner, rootDirectory) };
    if (!isGroupableRule(diagnostic)) return result;
    const groupId = buildFixGroupId(diagnostic);
    if ((siteCountByGroupId.get(groupId) ?? 0) < MIN_SHARED_FIX_SITE_COUNT) return result;
    return { ...result, fixGroupId: groupId };
  });
};
