import { fingerprintDiagnosticEvidence } from "./utils/fingerprint-diagnostic-evidence.js";
import type { Diagnostic } from "./types/index.js";

export const DIAGNOSTIC_DELTA_IDENTITY = Symbol.for("react-doctor/diagnostic-delta-identity");

export interface DiagnosticDelta {
  readonly newDiagnostics: Diagnostic[];
  readonly fixedCount: number;
  readonly crossFileMatchCount: number;
  readonly ruleCountMatchCount: number;
}

export interface ComputeDiagnosticDeltaInput {
  readonly renamedFiles?: Readonly<Record<string, string>>;
  readonly headDiagnostics: ReadonlyArray<Diagnostic>;
  readonly baseDiagnostics: ReadonlyArray<Diagnostic>;
  readonly readHeadLine: (filePath: string, line: number) => string | null;
  readonly readBaseLine: (filePath: string, line: number) => string | null;
  readonly readHeadEvidence?: (diagnostic: Diagnostic) => string | null;
  readonly readBaseEvidence?: (diagnostic: Diagnostic) => string | null;
  readonly mapBaseLine?: (headFilePath: string, baseLine: number) => number;
}

interface DiagnosticGroup {
  readonly headIndexes: number[];
  readonly baseIndexes: number[];
}

interface DiagnosticMatchCandidate {
  readonly diagnosticIndex: number;
  readonly fingerprint: string | null;
  readonly message: string;
  readonly messageWords: ReadonlySet<string>;
  readonly line: number;
}

interface DiagnosticMatchRank {
  readonly messageSimilarity: number;
  readonly lineDistance: number;
}

const buildMatchCandidates = (
  diagnostics: ReadonlyArray<Diagnostic>,
  indexes: ReadonlyArray<number>,
  readEvidence: ComputeDiagnosticDeltaInput["readHeadEvidence"],
  readLine: ComputeDiagnosticDeltaInput["readHeadLine"],
  mapLine: (diagnostic: Diagnostic) => number,
): DiagnosticMatchCandidate[] =>
  indexes.map((diagnosticIndex) => {
    const diagnostic = diagnostics[diagnosticIndex];
    const explicitIdentity = Reflect.get(diagnostic, DIAGNOSTIC_DELTA_IDENTITY);
    let fingerprint = diagnostic.fingerprint ?? null;
    if (typeof explicitIdentity === "string") {
      fingerprint = `identity:${fingerprintDiagnosticEvidence(explicitIdentity)}`;
    } else if (fingerprint === null) {
      const evidence = readEvidence?.(diagnostic) ?? readLine(diagnostic.filePath, diagnostic.line);
      if (evidence?.trim()) fingerprint = fingerprintDiagnosticEvidence(evidence);
    }
    const message = `${diagnostic.title ?? ""}\0${diagnostic.message}`;
    return {
      diagnosticIndex,
      fingerprint,
      message,
      messageWords: new Set(message.toLowerCase().match(/\w+/g) ?? []),
      line: mapLine(diagnostic),
    };
  });

const compareMatchRanks = (left: DiagnosticMatchRank, right: DiagnosticMatchRank): number =>
  right.messageSimilarity - left.messageSimilarity || left.lineDistance - right.lineDistance;

const rankDiagnosticMatch = (
  head: DiagnosticMatchCandidate,
  base: DiagnosticMatchCandidate,
): DiagnosticMatchRank => {
  let sharedWordCount = 0;
  for (const word of head.messageWords) {
    if (base.messageWords.has(word)) sharedWordCount += 1;
  }
  const unionWordCount = head.messageWords.size + base.messageWords.size - sharedWordCount;
  return {
    messageSimilarity:
      head.message === base.message ? 1 : sharedWordCount / Math.max(1, unionWordCount),
    lineDistance: Math.abs(head.line - base.line),
  };
};

export const computeDiagnosticDelta = (input: ComputeDiagnosticDeltaInput): DiagnosticDelta => {
  const groups = new Map<string, DiagnosticGroup>();
  for (const isBase of [true, false]) {
    const diagnostics = isBase ? input.baseDiagnostics : input.headDiagnostics;
    diagnostics.forEach((diagnostic, diagnosticIndex) => {
      const filePath = isBase
        ? (input.renamedFiles?.[diagnostic.filePath] ?? diagnostic.filePath)
        : diagnostic.filePath;
      const groupKey = `${filePath}\0${diagnostic.plugin}/${diagnostic.rule}`;
      const group = groups.get(groupKey) ?? { headIndexes: [], baseIndexes: [] };
      (isBase ? group.baseIndexes : group.headIndexes).push(diagnosticIndex);
      groups.set(groupKey, group);
    });
  }

  const newIndexes = new Set<number>();
  let fixedCount = 0;
  let crossFileMatchCount = 0;
  let ruleCountMatchCount = 0;
  for (const group of groups.values()) {
    const matchedCount = Math.min(group.headIndexes.length, group.baseIndexes.length);
    fixedCount += group.baseIndexes.length - matchedCount;
    crossFileMatchCount += Math.min(
      matchedCount,
      group.baseIndexes.filter((diagnosticIndex) =>
        Boolean(input.renamedFiles?.[input.baseDiagnostics[diagnosticIndex].filePath]),
      ).length,
    );
    if (group.headIndexes.length <= group.baseIndexes.length) {
      ruleCountMatchCount += matchedCount;
      continue;
    }
    if (group.baseIndexes.length === 0) {
      for (const diagnosticIndex of group.headIndexes) newIndexes.add(diagnosticIndex);
      continue;
    }

    const headCandidates = buildMatchCandidates(
      input.headDiagnostics,
      group.headIndexes,
      input.readHeadEvidence,
      input.readHeadLine,
      (diagnostic) => diagnostic.line,
    );
    const baseCandidates = buildMatchCandidates(
      input.baseDiagnostics,
      group.baseIndexes,
      input.readBaseEvidence,
      input.readBaseLine,
      (diagnostic) =>
        input.mapBaseLine?.(
          input.renamedFiles?.[diagnostic.filePath] ?? diagnostic.filePath,
          diagnostic.line,
        ) ?? diagnostic.line,
    ).sort((left, right) => left.line - right.line);
    const unmatchedHeads = new Map(
      headCandidates.map((candidate) => [candidate.diagnosticIndex, candidate]),
    );
    const unmatchedBases = new Set(baseCandidates);
    for (const matchKind of ["exact", "fingerprint", "message"]) {
      const headBuckets = new Map<string, DiagnosticMatchCandidate[]>();
      const keyFor = (candidate: DiagnosticMatchCandidate): string | null => {
        if (matchKind === "message") return candidate.message;
        if (matchKind === "fingerprint") return candidate.fingerprint;
        if (candidate.fingerprint === null) return null;
        return JSON.stringify([candidate.fingerprint, candidate.message]);
      };
      for (const head of unmatchedHeads.values()) {
        const key = keyFor(head);
        if (key === null) continue;
        const bucket = headBuckets.get(key) ?? [];
        bucket.push(head);
        headBuckets.set(key, bucket);
      }
      for (const base of unmatchedBases) {
        const key = keyFor(base);
        const bucket = key === null ? undefined : headBuckets.get(key);
        if (!bucket?.length) continue;
        let closestIndex = 0;
        for (let index = 1; index < bucket.length; index += 1) {
          if (
            Math.abs(bucket[index].line - base.line) <
            Math.abs(bucket[closestIndex].line - base.line)
          ) {
            closestIndex = index;
          }
        }
        const [head] = bucket.splice(closestIndex, 1);
        unmatchedHeads.delete(head.diagnosticIndex);
        unmatchedBases.delete(base);
        if (matchKind !== "exact") ruleCountMatchCount += 1;
      }
    }
    for (const base of unmatchedBases) {
      let bestHead: DiagnosticMatchCandidate | undefined;
      let bestRank: DiagnosticMatchRank | undefined;
      for (const head of unmatchedHeads.values()) {
        const rank = rankDiagnosticMatch(head, base);
        if (!bestRank || compareMatchRanks(rank, bestRank) < 0) {
          bestHead = head;
          bestRank = rank;
        }
      }
      if (bestHead) {
        unmatchedHeads.delete(bestHead.diagnosticIndex);
        ruleCountMatchCount += 1;
      }
    }
    for (const diagnosticIndex of unmatchedHeads.keys()) newIndexes.add(diagnosticIndex);
  }

  return {
    newDiagnostics: input.headDiagnostics.filter((_diagnostic, index) => newIndexes.has(index)),
    fixedCount,
    crossFileMatchCount,
    ruleCountMatchCount,
  };
};
