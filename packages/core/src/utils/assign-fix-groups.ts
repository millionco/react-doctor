import { createHash } from "node:crypto";
import {
  FIX_GROUP_ID_LENGTH_CHARS,
  MIN_SHARED_FIX_SITE_COUNT,
  ROOT_CAUSE_GROUPABLE_RULE_KEYS,
} from "../constants.js";
import type { Diagnostic } from "../types/index.js";

// Stable, content-derived id for the root-cause group a finding belongs to.
// Same file + rule + message means one fix (e.g. four state resets on a single
// prop change all clear with one `key` prop), so those findings share an id.
// The fields are JSON-encoded before hashing so no manual delimiter can let one
// field's tail alias the next; sha1 keeps the id stable across runs, matching
// `buildDiagnosticIdentity`'s content-keyed philosophy.
const buildFixGroupId = (diagnostic: Diagnostic): string =>
  createHash("sha1")
    .update(
      JSON.stringify([
        diagnostic.filePath,
        `${diagnostic.plugin}/${diagnostic.rule}`,
        diagnostic.message,
      ]),
    )
    .digest("hex")
    .slice(0, FIX_GROUP_ID_LENGTH_CHARS);

const isGroupableRule = (diagnostic: Diagnostic): boolean =>
  ROOT_CAUSE_GROUPABLE_RULE_KEYS.has(`${diagnostic.plugin}/${diagnostic.rule}`);

// Stamps a shared `fixGroupId` on findings that one fix resolves together, so
// a consumer that turns findings into tasks counts a single root cause as one
// task rather than N. Only findings of a root-cause-groupable rule that share
// (file, rule, message) with at least one sibling get an id; everything else
// passes through untouched. Score-neutral — the score reads neither the field
// nor the count — so this runs purely as a presentation/report concern.
export const assignFixGroups = (diagnostics: ReadonlyArray<Diagnostic>): Diagnostic[] => {
  const siteCountByGroupId = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    if (!isGroupableRule(diagnostic)) continue;
    const groupId = buildFixGroupId(diagnostic);
    siteCountByGroupId.set(groupId, (siteCountByGroupId.get(groupId) ?? 0) + 1);
  }

  return diagnostics.map((diagnostic) => {
    if (!isGroupableRule(diagnostic)) return diagnostic;
    const groupId = buildFixGroupId(diagnostic);
    if ((siteCountByGroupId.get(groupId) ?? 0) < MIN_SHARED_FIX_SITE_COUNT) return diagnostic;
    return { ...diagnostic, fixGroupId: groupId };
  });
};
