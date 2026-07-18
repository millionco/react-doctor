import { createHash } from "node:crypto";
import type { Diagnostic } from "./types/index.js";

export interface DiagnosticDelta {
  /** Diagnostics present in head with no base match — introduced by the change. */
  readonly newDiagnostics: Diagnostic[];
  /** Count of base diagnostics with no head match — resolved by the change. */
  readonly fixedCount: number;
  /** Pre-existing diagnostics matched after moving to a different file. */
  readonly crossFileMatchCount: number;
}

export interface ComputeDiagnosticDeltaInput {
  readonly headDiagnostics: ReadonlyArray<Diagnostic>;
  readonly baseDiagnostics: ReadonlyArray<Diagnostic>;
  readonly readHeadLine: (filePath: string, line: number) => string | null;
  readonly readBaseLine: (filePath: string, line: number) => string | null;
  /** Returns the normalized source range diagnosed in the head tree. */
  readonly readHeadEvidence?: (diagnostic: Diagnostic) => string | null;
  /** Returns the normalized source range diagnosed in the base tree. */
  readonly readBaseEvidence?: (diagnostic: Diagnostic) => string | null;
}

interface DiagnosticMatchKeys {
  readonly stableEvidenceKey: string | null;
  readonly sameFileFallbackKey: string | null;
}

interface DiagnosticIndexBucket {
  readonly diagnosticIndexes: number[];
  nextCandidateIndex: number;
}

const fingerprintText = (text: string): string => createHash("sha256").update(text).digest("hex");

const normalizeEvidence = (evidence: string): string => evidence.replace(/\s+/g, " ").trim();

const getDiagnosticMatchKeys = (
  diagnostic: Diagnostic,
  evidence: string | null,
): DiagnosticMatchKeys => {
  const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
  const messageFingerprint = fingerprintText(`${diagnostic.title ?? ""}\0${diagnostic.message}`);
  const normalizedEvidence = evidence === null ? "" : normalizeEvidence(evidence);
  return {
    stableEvidenceKey:
      normalizedEvidence.length > 0
        ? `evidence\0${ruleKey}\0${messageFingerprint}\0${fingerprintText(normalizedEvidence)}`
        : null,
    sameFileFallbackKey:
      diagnostic.matchByOccurrence || normalizedEvidence.length === 0
        ? `fallback\0${diagnostic.filePath}\0${ruleKey}\0${messageFingerprint}`
        : null,
  };
};

const addDiagnosticIndex = (
  buckets: Map<string, DiagnosticIndexBucket>,
  key: string | null,
  diagnosticIndex: number,
): void => {
  if (key === null) return;
  const bucket = buckets.get(key) ?? { diagnosticIndexes: [], nextCandidateIndex: 0 };
  bucket.diagnosticIndexes.push(diagnosticIndex);
  buckets.set(key, bucket);
};

const takeMatchingDiagnosticIndex = (
  buckets: Map<string, DiagnosticIndexBucket>,
  key: string | null,
  matchedDiagnosticIndexes: ReadonlySet<number>,
): number | null => {
  if (key === null) return null;
  const bucket = buckets.get(key);
  if (bucket === undefined) return null;
  while (bucket.nextCandidateIndex < bucket.diagnosticIndexes.length) {
    const diagnosticIndex = bucket.diagnosticIndexes[bucket.nextCandidateIndex];
    bucket.nextCandidateIndex += 1;
    if (diagnosticIndex !== undefined && !matchedDiagnosticIndexes.has(diagnosticIndex)) {
      return diagnosticIndex;
    }
  }
  return null;
};

const readDiagnosticEvidence = (
  diagnostic: Diagnostic,
  readEvidence: ComputeDiagnosticDeltaInput["readHeadEvidence"],
  readLine: ComputeDiagnosticDeltaInput["readHeadLine"],
): string | null => readEvidence?.(diagnostic) ?? readLine(diagnostic.filePath, diagnostic.line);

/**
 * Diffs a head scan against a base scan using a multiset of construct-level
 * evidence. Stable identities combine plugin/rule, the diagnostic message,
 * and normalized diagnosed source, so unchanged findings can move across
 * files while changed constructs or messages remain new. Cardinality is
 * retained for identical findings. Diagnostics explicitly marked
 * `matchByOccurrence` may fall back to same-file plugin/rule/message matching
 * after strict evidence matching, preserving structural reformatting without
 * letting unrelated findings cancel across files. Unreadable evidence uses the
 * same conservative fallback rather than matching across files without proof.
 */
export const computeDiagnosticDelta = (input: ComputeDiagnosticDeltaInput): DiagnosticDelta => {
  const baseByStableEvidence = new Map<string, DiagnosticIndexBucket>();
  const baseBySameFileFallback = new Map<string, DiagnosticIndexBucket>();
  for (const [diagnosticIndex, diagnostic] of input.baseDiagnostics.entries()) {
    const evidence = readDiagnosticEvidence(diagnostic, input.readBaseEvidence, input.readBaseLine);
    const matchKeys = getDiagnosticMatchKeys(diagnostic, evidence);
    addDiagnosticIndex(baseByStableEvidence, matchKeys.stableEvidenceKey, diagnosticIndex);
    addDiagnosticIndex(baseBySameFileFallback, matchKeys.sameFileFallbackKey, diagnosticIndex);
  }

  const newDiagnostics: Diagnostic[] = [];
  const matchedBaseDiagnosticIndexes = new Set<number>();
  let crossFileMatchCount = 0;
  for (const diagnostic of input.headDiagnostics) {
    const evidence = readDiagnosticEvidence(diagnostic, input.readHeadEvidence, input.readHeadLine);
    const matchKeys = getDiagnosticMatchKeys(diagnostic, evidence);
    const stableMatchIndex = takeMatchingDiagnosticIndex(
      baseByStableEvidence,
      matchKeys.stableEvidenceKey,
      matchedBaseDiagnosticIndexes,
    );
    const matchingDiagnosticIndex =
      stableMatchIndex ??
      takeMatchingDiagnosticIndex(
        baseBySameFileFallback,
        matchKeys.sameFileFallbackKey,
        matchedBaseDiagnosticIndexes,
      );
    const matchingBaseDiagnostic =
      matchingDiagnosticIndex === null ? undefined : input.baseDiagnostics[matchingDiagnosticIndex];
    if (matchingDiagnosticIndex !== null && matchingBaseDiagnostic !== undefined) {
      matchedBaseDiagnosticIndexes.add(matchingDiagnosticIndex);
      if (stableMatchIndex !== null && matchingBaseDiagnostic.filePath !== diagnostic.filePath) {
        crossFileMatchCount += 1;
      }
    } else {
      newDiagnostics.push(diagnostic);
    }
  }

  const fixedCount = input.baseDiagnostics.length - matchedBaseDiagnosticIndexes.size;

  return { newDiagnostics, fixedCount, crossFileMatchCount };
};
