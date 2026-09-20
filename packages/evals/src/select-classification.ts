import { createHash } from "node:crypto";

import type { ClassificationCandidate } from "./classification-schema.js";
import { CLASSIFICATION_SELECTION_SEED } from "./constants.js";

export interface SelectionStratum {
  repository: string;
  rule: string;
  eligible: number;
  selected: number;
  occurrences: number;
}

export interface ClassificationSelection {
  candidates: ClassificationCandidate[];
  coverage: {
    seed: string;
    eligibleRepositories: number;
    selectedRepositories: number;
    eligibleRules: number;
    selectedRules: number;
    eligibleGroups: number;
    selectedGroups: number;
    eligibleOccurrences: number;
    selectedOccurrences: number;
    strata: SelectionStratum[];
  };
}

const repositoryKey = (candidate: ClassificationCandidate): string =>
  `${candidate.repository.org}/${candidate.repository.name}`;

const stratumKey = (candidate: ClassificationCandidate): string =>
  JSON.stringify([repositoryKey(candidate), candidate.rule.key]);

const rank = (identity: string): string =>
  createHash("sha256").update(`${CLASSIFICATION_SELECTION_SEED}:${identity}`).digest("hex");

const groupRank = (candidate: ClassificationCandidate): string =>
  rank(
    JSON.stringify([
      candidate.repository,
      candidate.project?.rootDirectory,
      candidate.rule.key,
      candidate.filePath,
      candidate.detected,
      candidate.detectorCommit,
      candidate.ruleSetHash,
    ]),
  );

export const selectClassification = async (
  readGroups: () => AsyncIterable<ClassificationCandidate>,
  limit: number,
): Promise<ClassificationSelection> => {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Selection limit must be positive");
  const strata = new Map<string, SelectionStratum>();
  const fingerprints = [createHash("sha256"), createHash("sha256")];
  for await (const candidate of readGroups()) {
    fingerprints[0].update(JSON.stringify(candidate));
    const key = stratumKey(candidate);
    const stratum = strata.get(key) ?? {
      repository: repositoryKey(candidate),
      rule: candidate.rule.key,
      eligible: 0,
      selected: 0,
      occurrences: 0,
    };
    stratum.eligible += 1;
    stratum.occurrences += candidate.occurrenceCount ?? Number(candidate.detected);
    strata.set(key, stratum);
  }
  const repositories = new Map<string, SelectionStratum[]>();
  for (const stratum of strata.values()) {
    const rules = repositories.get(stratum.repository) ?? [];
    rules.push(stratum);
    repositories.set(stratum.repository, rules);
  }
  const queues = [...repositories]
    .sort(([left], [right]) => rank(left).localeCompare(rank(right)))
    .map(([, rules]) =>
      rules.sort((left, right) =>
        rank(`${left.repository}:${left.rule}`).localeCompare(
          rank(`${right.repository}:${right.rule}`),
        ),
      ),
    );
  let allocated = 0;
  while (allocated < limit) {
    let progressed = false;
    for (const rules of queues) {
      const eligible = rules.filter((stratum) => stratum.selected < stratum.eligible);
      eligible.sort((left, right) => left.selected - right.selected);
      if (eligible.length === 0) continue;
      eligible[0].selected += 1;
      allocated += 1;
      progressed = true;
      if (allocated === limit) break;
    }
    if (!progressed) break;
  }
  const retained = new Map<string, Array<{ rank: string; candidate: ClassificationCandidate }>>();
  for await (const candidate of readGroups()) {
    fingerprints[1].update(JSON.stringify(candidate));
    const key = stratumKey(candidate);
    const quota = strata.get(key)?.selected ?? 0;
    if (quota === 0) continue;
    const ranked = retained.get(key) ?? [];
    const priority = groupRank(candidate);
    if (ranked.length === quota && priority >= ranked[ranked.length - 1].rank) continue;
    ranked.push({ rank: priority, candidate });
    ranked.sort((left, right) => left.rank.localeCompare(right.rank));
    if (ranked.length > quota) ranked.pop();
    retained.set(key, ranked);
  }
  if (fingerprints[0].digest("hex") !== fingerprints[1].digest("hex")) {
    throw new Error("Selection input changed between passes");
  }
  const candidates = [...retained.values()]
    .flat()
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .map(({ candidate }) => candidate);
  const coverageStrata = [...strata.values()].sort(
    (left, right) =>
      left.repository.localeCompare(right.repository) || left.rule.localeCompare(right.rule),
  );
  return {
    candidates,
    coverage: {
      seed: CLASSIFICATION_SELECTION_SEED,
      eligibleRepositories: repositories.size,
      selectedRepositories: new Set(candidates.map(repositoryKey)).size,
      eligibleRules: new Set(coverageStrata.map((stratum) => stratum.rule)).size,
      selectedRules: new Set(candidates.map((candidate) => candidate.rule.key)).size,
      eligibleGroups: coverageStrata.reduce((sum, stratum) => sum + stratum.eligible, 0),
      selectedGroups: candidates.length,
      eligibleOccurrences: coverageStrata.reduce((sum, stratum) => sum + stratum.occurrences, 0),
      selectedOccurrences: candidates.reduce(
        (sum, candidate) => sum + (candidate.occurrenceCount ?? Number(candidate.detected)),
        0,
      ),
      strata: coverageStrata,
    },
  };
};
