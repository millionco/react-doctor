import type { ClassificationAssessment } from "../classification-schema.js";
import type { CodeGradingCache } from "../code-grading-schema.js";
import { CODE_GRADING_CACHE_TTL_MS, CODE_GRADING_MAX_CACHE_ENTRIES } from "../constants.js";

export interface CodeGradingCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
  records?: ReadonlyArray<CodeGradingCacheRecord>;
}

export interface CodeGradingCacheRecord {
  id: string;
  assessment: ClassificationAssessment;
  expiresAt: number;
}

export interface CodeGradingSnapshotCache extends CodeGradingCache {
  snapshot: () => CodeGradingCacheRecord[];
}

export const createCodeGradingCache = ({
  maxEntries = CODE_GRADING_MAX_CACHE_ENTRIES,
  ttlMs = CODE_GRADING_CACHE_TTL_MS,
  now = Date.now,
  records = [],
}: CodeGradingCacheOptions = {}): CodeGradingSnapshotCache => {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new TypeError("Cache capacity and TTL must be positive");
  const entries = new Map<string, CodeGradingCacheRecord>();
  for (const record of records.slice(-maxEntries)) {
    if (record.expiresAt > now() && record.expiresAt <= now() + ttlMs)
      entries.set(record.id, structuredClone(record));
  }
  return {
    get: (id) => {
      const entry = entries.get(id);
      if (!entry) return undefined;
      entries.delete(id);
      if (entry.expiresAt <= now()) return undefined;
      entries.set(id, entry);
      return structuredClone(entry.assessment);
    },
    set: (id, assessment) => {
      entries.delete(id);
      entries.set(id, { id, assessment: structuredClone(assessment), expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
    },
    snapshot: () =>
      [...entries.values()]
        .filter((entry) => entry.expiresAt > now())
        .map((entry) => structuredClone(entry)),
  };
};
