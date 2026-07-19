#!/usr/bin/env node

import { readFileSync } from "node:fs";

const PARITY_SCHEMA_VERSION = 1;
const PARITY_DIFFERENCE_EXIT_CODE = 1;
const INVALID_INPUT_EXIT_CODE = 2;
const JSON_INDENT_SPACES = 2;
const EXPECTED_ARGUMENT_COUNT = 2;

const [baselinePath, candidatePath] = process.argv.slice(2);

if (process.argv.slice(2).length !== EXPECTED_ARGUMENT_COUNT) {
  process.stderr.write("Usage: compare-parity.mjs <baseline.ndjson> <candidate.ndjson>\n");
  process.exit(INVALID_INPUT_EXIT_CODE);
}

const projectKey = (repository) =>
  JSON.stringify([repository.org, repository.name, repository.ref, repository.rootDir]);

const diagnosticKey = (diagnostic) =>
  diagnostic.id ??
  JSON.stringify([
    diagnostic.normalizedFilePath ?? diagnostic.filePath,
    diagnostic.line,
    diagnostic.column,
    diagnostic.plugin,
    diagnostic.rule,
    diagnostic.severity,
    diagnostic.message,
  ]);

const loadRun = (filePath) => {
  const records = new Map();
  const lines = readFileSync(filePath, "utf8").split("\n");
  for (const [lineIndex, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const record = JSON.parse(line);
    if (record.schemaVersion !== PARITY_SCHEMA_VERSION || !record.repository) {
      throw new Error(`${filePath}:${lineIndex + 1} is not an eval schema v1 record`);
    }
    const key = projectKey(record.repository);
    if (records.has(key)) throw new Error(`${filePath} contains duplicate project ${key}`);
    records.set(key, record);
  }
  return records;
};

const diagnosticsByIdentity = (record) => {
  if (record.error) return { error: record.error };
  if (!record.report || !Array.isArray(record.report.diagnostics)) {
    return { error: "Missing report.diagnostics" };
  }
  const diagnostics = new Map();
  for (const diagnostic of record.report.diagnostics) {
    const key = diagnosticKey(diagnostic);
    const occurrences = diagnostics.get(key) ?? [];
    occurrences.push(diagnostic);
    diagnostics.set(key, occurrences);
  }
  return { diagnostics };
};

const summarizeRules = (entries) => {
  const counts = new Map();
  for (const entry of entries) {
    const rule = `${entry.diagnostic.plugin}/${entry.diagnostic.rule}`;
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return Array.from(counts, ([rule, count]) => ({ rule, count })).sort(
    (left, right) => right.count - left.count || left.rule.localeCompare(right.rule),
  );
};

try {
  const baselineRecords = loadRun(baselinePath);
  const candidateRecords = loadRun(candidatePath);
  if (baselineRecords.size === 0 || candidateRecords.size === 0) {
    throw new Error("Parity inputs must each contain at least one eval record");
  }
  const allProjectKeys = new Set([...baselineRecords.keys(), ...candidateRecords.keys()]);
  const added = [];
  const removed = [];
  const skippedProjects = [];
  let unchangedCount = 0;
  let baselineDiagnosticCount = 0;
  let candidateDiagnosticCount = 0;

  for (const key of allProjectKeys) {
    const baselineRecord = baselineRecords.get(key);
    const candidateRecord = candidateRecords.get(key);
    const repository = candidateRecord?.repository ?? baselineRecord?.repository;
    const baseline = baselineRecord
      ? diagnosticsByIdentity(baselineRecord)
      : { error: "Missing baseline record" };
    const candidate = candidateRecord
      ? diagnosticsByIdentity(candidateRecord)
      : { error: "Missing candidate record" };

    if (baseline.error || candidate.error) {
      skippedProjects.push({
        repository,
        baselineError: baseline.error,
        candidateError: candidate.error,
      });
      continue;
    }

    for (const occurrences of baseline.diagnostics.values()) {
      baselineDiagnosticCount += occurrences.length;
    }
    for (const occurrences of candidate.diagnostics.values()) {
      candidateDiagnosticCount += occurrences.length;
    }

    const identities = new Set([...baseline.diagnostics.keys(), ...candidate.diagnostics.keys()]);
    for (const identity of identities) {
      const baselineOccurrences = baseline.diagnostics.get(identity) ?? [];
      const candidateOccurrences = candidate.diagnostics.get(identity) ?? [];
      const sharedCount = Math.min(baselineOccurrences.length, candidateOccurrences.length);
      unchangedCount += sharedCount;
      for (const diagnostic of baselineOccurrences.slice(sharedCount)) {
        removed.push({ repository, diagnostic });
      }
      for (const diagnostic of candidateOccurrences.slice(sharedCount)) {
        added.push({ repository, diagnostic });
      }
    }
  }

  const result = {
    schemaVersion: PARITY_SCHEMA_VERSION,
    summary: {
      baselineProjects: baselineRecords.size,
      candidateProjects: candidateRecords.size,
      comparedProjects: allProjectKeys.size - skippedProjects.length,
      skippedProjects: skippedProjects.length,
      baselineDiagnostics: baselineDiagnosticCount,
      candidateDiagnostics: candidateDiagnosticCount,
      added: added.length,
      removed: removed.length,
      unchanged: unchangedCount,
    },
    rules: {
      added: summarizeRules(added),
      removed: summarizeRules(removed),
    },
    added,
    removed,
    skippedProjects,
  };

  process.stdout.write(`${JSON.stringify(result, undefined, JSON_INDENT_SPACES)}\n`);
  process.stderr.write(
    `Parity: +${added.length} -${removed.length}, unchanged ${unchangedCount}, skipped projects ${skippedProjects.length}\n`,
  );

  if (skippedProjects.length > 0) {
    process.exitCode = INVALID_INPUT_EXIT_CODE;
  } else if (added.length > 0 || removed.length > 0) {
    process.exitCode = PARITY_DIFFERENCE_EXIT_CODE;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = INVALID_INPUT_EXIT_CODE;
}
