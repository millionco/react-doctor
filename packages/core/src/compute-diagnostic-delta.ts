import { createHash } from "node:crypto";
import type { Diagnostic } from "./types/index.js";

export interface DiagnosticDelta {
  /** Diagnostics present in head with no base match — introduced by the change. */
  readonly newDiagnostics: Diagnostic[];
  /** Count of base diagnostics with no head match — resolved by the change. */
  readonly fixedCount: number;
}

export interface ComputeDiagnosticDeltaInput {
  readonly headDiagnostics: ReadonlyArray<Diagnostic>;
  readonly baseDiagnostics: ReadonlyArray<Diagnostic>;
  /**
   * Returns the source text of `filePath:line` in the head / base trees. It
   * fingerprints a diagnostic by the *content* of its flagged line rather than
   * the absolute line number, so code that merely shifted down (lines inserted
   * above it) is matched as pre-existing instead of reported as new. Return
   * `null` when the line can't be read; the fingerprint then falls back to
   * `(file, rule)` and diagnostics are matched in order.
   */
  readonly readHeadLine: (filePath: string, line: number) => string | null;
  readonly readBaseLine: (filePath: string, line: number) => string | null;
}

const fingerprintDiagnostic = (diagnostic: Diagnostic, lineText: string | null): string => {
  const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
  const snippet = lineText === null ? "" : createHash("sha1").update(lineText.trim()).digest("hex");
  return `${diagnostic.filePath}\u0000${ruleKey}\u0000${snippet}`;
};

/**
 * Diffs a head scan against a base scan to isolate the diagnostics a change
 * introduced (and count the ones it resolved). Matching is a multiset over a
 * position-independent fingerprint — `(filePath, plugin/rule, hash(flagged
 * line text))` — so inserting lines above an existing issue doesn't make it
 * look new, while a genuinely new occurrence (new line text, or one more of
 * the same) surfaces. Identical repeated findings are matched by count.
 *
 * v1 limitation: the fingerprint keys on the head-relative `filePath`, and base
 * content is read at that same path. A file renamed by the change therefore has
 * no base match, so its pre-existing findings are reported as new. This
 * over-reports (never hides a real issue) and is rare; rename-aware base
 * resolution is a follow-up.
 */
export const computeDiagnosticDelta = (input: ComputeDiagnosticDeltaInput): DiagnosticDelta => {
  const unmatchedBaseByFingerprint = new Map<string, number>();
  for (const diagnostic of input.baseDiagnostics) {
    const key = fingerprintDiagnostic(
      diagnostic,
      input.readBaseLine(diagnostic.filePath, diagnostic.line),
    );
    unmatchedBaseByFingerprint.set(key, (unmatchedBaseByFingerprint.get(key) ?? 0) + 1);
  }

  const newDiagnostics: Diagnostic[] = [];
  for (const diagnostic of input.headDiagnostics) {
    const key = fingerprintDiagnostic(
      diagnostic,
      input.readHeadLine(diagnostic.filePath, diagnostic.line),
    );
    const availableMatches = unmatchedBaseByFingerprint.get(key) ?? 0;
    if (availableMatches > 0) {
      unmatchedBaseByFingerprint.set(key, availableMatches - 1);
    } else {
      newDiagnostics.push(diagnostic);
    }
  }

  let fixedCount = 0;
  for (const remaining of unmatchedBaseByFingerprint.values()) {
    fixedCount += remaining;
  }

  return { newDiagnostics, fixedCount };
};
