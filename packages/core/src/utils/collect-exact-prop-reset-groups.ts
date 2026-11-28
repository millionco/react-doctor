import type { Diagnostic } from "../types/index.js";

const PROP_ADJUSTMENT_RULE = "no-adjust-state-on-prop-change";
const ALL_STATE_RESET_RULE = "no-reset-all-state-on-prop-change";

const siteKey = (filePath: string, offset: number, length: number): string =>
  JSON.stringify([filePath, offset, length]);

export const collectExactPropResetGroups = (
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyMap<Diagnostic, Diagnostic> => {
  const effectDiagnostics = diagnostics.filter(
    (diagnostic) =>
      diagnostic.plugin === "react-doctor" &&
      diagnostic.rule === ALL_STATE_RESET_RULE &&
      diagnostic.contextRanges?.length,
  );
  const groups = new Map<Diagnostic, Diagnostic>();
  if (effectDiagnostics.length === 0) return groups;

  const writesBySite = new Map<string, Diagnostic | null>();
  for (const diagnostic of diagnostics) {
    const { filePath, offset, length } = diagnostic;
    if (
      diagnostic.plugin !== "react-doctor" ||
      diagnostic.rule !== PROP_ADJUSTMENT_RULE ||
      offset === undefined ||
      length === undefined
    ) {
      continue;
    }
    const key = siteKey(filePath, offset, length);
    writesBySite.set(key, writesBySite.has(key) ? null : diagnostic);
  }

  const membersByEffect = new Map<Diagnostic, Set<Diagnostic>>();
  const ownersByWrite = new Map<Diagnostic, Diagnostic | null>();
  for (const effect of effectDiagnostics) {
    const { filePath, offset, length, contextRanges } = effect;
    if (offset === undefined || length === undefined || !contextRanges?.length) continue;
    const writes = new Set<Diagnostic>();
    for (const range of contextRanges) {
      if (
        range.length <= 0 ||
        range.offset < offset ||
        range.offset + range.length > offset + length
      ) {
        break;
      }
      const write = writesBySite.get(siteKey(filePath, range.offset, range.length));
      if (!write) break;
      writes.add(write);
    }
    if (writes.size !== contextRanges.length) continue;
    membersByEffect.set(effect, writes);
    for (const write of writes) {
      ownersByWrite.set(write, ownersByWrite.has(write) ? null : effect);
    }
  }

  for (const [effect, writes] of membersByEffect) {
    if ([...writes].some((write) => ownersByWrite.get(write) !== effect)) continue;
    groups.set(effect, effect);
    for (const write of writes) groups.set(write, effect);
  }
  return groups;
};
