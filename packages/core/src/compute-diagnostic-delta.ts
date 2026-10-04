import { fingerprintDiagnosticEvidence } from "./utils/fingerprint-diagnostic-evidence.js";
import type { Diagnostic } from "./types/index.js";

export const DIAGNOSTIC_DELTA_IDENTITY = Symbol.for("react-doctor/diagnostic-delta-identity");

export interface DiagnosticDelta {
  /** Diagnostics present in head with no base match — introduced by the change. */
  readonly newDiagnostics: Diagnostic[];
  /** Count of base diagnostics with no head match — resolved by the change. */
  readonly fixedCount: number;
  /** Pre-existing diagnostics matched after moving to a different file. */
  readonly crossFileMatchCount: number;
}

export interface ComputeDiagnosticDeltaInput {
  /** When provided, cross-file matches require an entry from old path to new path. */
  readonly renamedFiles?: Readonly<Record<string, string>>;
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
  readonly sameFileStableEvidenceKey: string | null;
  readonly sameFileFallbackKey: string | null;
}

interface DiagnosticMatchCandidate extends DiagnosticMatchKeys {
  readonly diagnosticIndex: number;
}

const getDiagnosticMatchKeys = (
  diagnostic: Diagnostic,
  evidence: string | null,
): DiagnosticMatchKeys => {
  const ruleKey = `${diagnostic.plugin}/${diagnostic.rule}`;
  const messageFingerprint = fingerprintDiagnosticEvidence(
    `${diagnostic.title ?? ""}\0${diagnostic.message}`,
  );
  const evidenceFingerprint =
    diagnostic.fingerprint ?? (evidence?.trim() ? fingerprintDiagnosticEvidence(evidence) : null);
  const explicitIdentity = Reflect.get(diagnostic, DIAGNOSTIC_DELTA_IDENTITY);
  let explicitIdentityKey: string | null = null;
  if (typeof explicitIdentity === "string") {
    explicitIdentityKey = `identity\0${ruleKey}\0${fingerprintDiagnosticEvidence(explicitIdentity)}`;
  } else if (diagnostic.fingerprint?.startsWith("identity:")) {
    explicitIdentityKey = `identity\0${ruleKey}\0${diagnostic.fingerprint.slice("identity:".length)}`;
  }
  const stableEvidenceKey =
    explicitIdentityKey ??
    (evidenceFingerprint !== null
      ? `evidence\0${ruleKey}\0${messageFingerprint}\0${evidenceFingerprint}`
      : null);
  return {
    stableEvidenceKey,
    sameFileStableEvidenceKey:
      stableEvidenceKey === null ? null : `${diagnostic.filePath}\0${stableEvidenceKey}`,
    sameFileFallbackKey:
      explicitIdentityKey === null &&
      diagnostic.fingerprint === undefined &&
      (diagnostic.matchByOccurrence || evidenceFingerprint === null)
        ? `fallback\0${diagnostic.filePath}\0${ruleKey}\0${messageFingerprint}`
        : null,
  };
};

const addDiagnosticIndex = (
  buckets: Map<string, number[]>,
  key: string | null,
  diagnosticIndex: number,
): void => {
  if (key === null) return;
  const diagnosticIndexes = buckets.get(key) ?? [];
  diagnosticIndexes.push(diagnosticIndex);
  buckets.set(key, diagnosticIndexes);
};

const takeMatchingDiagnosticIndex = (
  buckets: ReadonlyMap<string, ReadonlyArray<number>>,
  key: string | null,
  matchedDiagnosticIndexes: ReadonlySet<number>,
): number | null => {
  if (key === null) return null;
  for (const diagnosticIndex of buckets.get(key) ?? []) {
    if (!matchedDiagnosticIndexes.has(diagnosticIndex)) return diagnosticIndex;
  }
  return null;
};

const readDiagnosticEvidence = (
  diagnostic: Diagnostic,
  readEvidence: ComputeDiagnosticDeltaInput["readHeadEvidence"],
  readLine: ComputeDiagnosticDeltaInput["readHeadLine"],
): string | null => readEvidence?.(diagnostic) ?? readLine(diagnostic.filePath, diagnostic.line);

const buildMatchCandidates = (
  diagnostics: ReadonlyArray<Diagnostic>,
  readEvidence: ComputeDiagnosticDeltaInput["readHeadEvidence"],
  readLine: ComputeDiagnosticDeltaInput["readHeadLine"],
  renamedFiles: Readonly<Record<string, string>> = {},
): DiagnosticMatchCandidate[] =>
  diagnostics.map((diagnostic, diagnosticIndex) => ({
    diagnosticIndex,
    ...getDiagnosticMatchKeys(
      { ...diagnostic, filePath: renamedFiles[diagnostic.filePath] ?? diagnostic.filePath },
      readDiagnosticEvidence(diagnostic, readEvidence, readLine),
    ),
  }));

/**
 * Diffs a head scan against a base scan using a multiset of construct-level
 * evidence. Detector-provided identities take precedence when source text is
 * intentionally normalized. Otherwise, stable identities combine plugin/rule,
 * the diagnostic message, and normalized diagnosed source, so unchanged
 * findings can move across files while changed constructs or messages remain
 * new. Cardinality is retained for identical findings. Diagnostics explicitly marked
 * `matchByOccurrence` may fall back to same-file plugin/rule/message matching
 * after same-file strict evidence matching. Cross-file evidence matching runs
 * last so a copy cannot consume a reformatted local occurrence. Unreadable
 * evidence uses the same conservative fallback rather than matching across
 * files without proof.
 */
export const computeDiagnosticDelta = (input: ComputeDiagnosticDeltaInput): DiagnosticDelta => {
  const baseCandidates = buildMatchCandidates(
    input.baseDiagnostics,
    input.readBaseEvidence,
    input.readBaseLine,
    input.renamedFiles,
  );
  const headCandidates = buildMatchCandidates(
    input.headDiagnostics,
    input.readHeadEvidence,
    input.readHeadLine,
  );
  const baseByStableEvidence = new Map<string, number[]>();
  const baseBySameFileStableEvidence = new Map<string, number[]>();
  const baseBySameFileFallback = new Map<string, number[]>();
  for (const candidate of baseCandidates) {
    addDiagnosticIndex(
      baseByStableEvidence,
      candidate.stableEvidenceKey,
      candidate.diagnosticIndex,
    );
    addDiagnosticIndex(
      baseBySameFileStableEvidence,
      candidate.sameFileStableEvidenceKey,
      candidate.diagnosticIndex,
    );
    addDiagnosticIndex(
      baseBySameFileFallback,
      candidate.sameFileFallbackKey,
      candidate.diagnosticIndex,
    );
  }

  const matchedHeadDiagnosticIndexes = new Set<number>();
  const matchedBaseDiagnosticIndexes = new Set<number>();
  const matchCandidates = (
    baseBuckets: ReadonlyMap<string, ReadonlyArray<number>>,
    getKey: (candidate: DiagnosticMatchCandidate) => string | null,
    onMatch?: (headDiagnosticIndex: number, baseDiagnosticIndex: number) => void,
  ): void => {
    for (const candidate of headCandidates) {
      if (matchedHeadDiagnosticIndexes.has(candidate.diagnosticIndex)) continue;
      const baseDiagnosticIndex = takeMatchingDiagnosticIndex(
        baseBuckets,
        getKey(candidate),
        matchedBaseDiagnosticIndexes,
      );
      if (baseDiagnosticIndex === null) continue;
      matchedHeadDiagnosticIndexes.add(candidate.diagnosticIndex);
      matchedBaseDiagnosticIndexes.add(baseDiagnosticIndex);
      onMatch?.(candidate.diagnosticIndex, baseDiagnosticIndex);
    }
  };

  matchCandidates(baseBySameFileStableEvidence, (candidate) => candidate.sameFileStableEvidenceKey);
  matchCandidates(baseBySameFileFallback, (candidate) => candidate.sameFileFallbackKey);
  let unrestrictedCrossFileMatchCount = 0;
  if (input.renamedFiles === undefined) {
    matchCandidates(
      baseByStableEvidence,
      (candidate) => candidate.stableEvidenceKey,
      (headIndex, baseIndex) => {
        if (input.headDiagnostics[headIndex].filePath !== input.baseDiagnostics[baseIndex].filePath)
          unrestrictedCrossFileMatchCount += 1;
      },
    );
  }
  const crossFileMatchCount =
    [...matchedBaseDiagnosticIndexes].filter((diagnosticIndex) =>
      Boolean(input.renamedFiles?.[input.baseDiagnostics[diagnosticIndex].filePath]),
    ).length + unrestrictedCrossFileMatchCount;

  const newDiagnostics = input.headDiagnostics.filter(
    (_diagnostic, diagnosticIndex) => !matchedHeadDiagnosticIndexes.has(diagnosticIndex),
  );
  const fixedCount = input.baseDiagnostics.length - matchedBaseDiagnosticIndexes.size;

  return { newDiagnostics, fixedCount, crossFileMatchCount };
};
