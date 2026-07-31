#!/usr/bin/env node

import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve as resolveFileSystemPath } from "node:path";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const PARITY_SCHEMA_VERSION = 1;
const PARITY_DIFFERENCE_EXIT_CODE = 1;
const INVALID_INPUT_EXIT_CODE = 2;
const JSON_INDENT_SPACES = 2;
const EXPECTED_ARGUMENT_COUNT = 2;
const SCOPED_ARGUMENT_COUNT = 4;
const BASELINE_RECORD_FILE_SUFFIX = ".json";
const PINNED_REF_PATTERN = /^[0-9a-f]{40}$/i;
const RULE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9-]*$/;
const REPORT_SCHEMA_VERSIONS = new Set([1, 2, 3]);
const REPORT_MODES = new Set(["full", "diff", "staged", "baseline"]);
const REPORT_FRAMEWORKS = new Set([
  "nextjs",
  "vite",
  "cra",
  "remix",
  "gatsby",
  "expo",
  "react-native",
  "tanstack-start",
  "preact",
  "astro",
  "unknown",
]);
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+$/;
const UNSAFE_ROOT_DIRECTORY_PATTERN = /["'`$;&|<>\\\r\n]/;
export const INVARIANT_DIAGNOSTIC_PLUGIN = "TS";
export const TYPESCRIPT_INVARIANT_RULE_SCOPE = `${INVARIANT_DIAGNOSTIC_PLUGIN}/*`;
export const INVARIANT_DIAGNOSTIC_RULE_KEYS = new Set([
  "react-doctor/expo-env-local-not-gitignored",
  "react-doctor/expo-gitignore",
  "react-doctor/expo-lockfile",
  "react-doctor/expo-metro-config",
  "react-doctor/expo-no-cli-dependencies",
  "react-doctor/expo-no-conflicting-dependency-override",
  "react-doctor/expo-no-redundant-dependency",
  "react-doctor/expo-no-unimodules-packages",
  "react-doctor/expo-package-json-conflict",
  "react-doctor/expo-reanimated-v4-requires-new-arch",
  "react-doctor/expo-router-no-react-navigation",
  "react-doctor/expo-updates-no-unsafe-production-config",
  "react-doctor/expo-vector-icons-conflict",
  "react-doctor/no-vulnerable-react-server-components",
  "react-doctor/require-pnpm-hardening",
  "react-doctor/require-reduced-motion",
  "react-doctor/rn-android-release-shrinking-disabled",
  "react-doctor/rn-library-react-in-dependencies",
  "react-doctor/rn-no-metro-babel-preset",
  "react-doctor/rn-no-metro-babel-runtime-version",
  "react-doctor/rn-react-compiler-plugin-first",
  "react-doctor/rn-reanimated-worklets-plugin-last",
]);

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export const loadSelectedRuleKeys = (ruleKeysPath) => {
  if (!ruleKeysPath) return null;
  let parsedRuleKeys;
  try {
    parsedRuleKeys = JSON.parse(readFileSync(ruleKeysPath, "utf8"));
  } catch {
    throw new Error(`${ruleKeysPath} is not valid JSON`);
  }
  if (
    !Array.isArray(parsedRuleKeys) ||
    parsedRuleKeys.length === 0 ||
    !parsedRuleKeys.every(
      (ruleKey) => typeof ruleKey === "string" && RULE_KEY_PATTERN.test(ruleKey),
    )
  ) {
    throw new Error(`${ruleKeysPath} must be a non-empty array of canonical plugin/rule keys`);
  }
  return new Set(parsedRuleKeys);
};

export const compareStrings = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const projectKey = (repository) =>
  JSON.stringify([repository.org, repository.name, repository.ref, repository.rootDir]);

const validateRepository = (repository) =>
  isRecord(repository) &&
  typeof repository.org === "string" &&
  GITHUB_OWNER_PATTERN.test(repository.org) &&
  typeof repository.name === "string" &&
  GITHUB_REPOSITORY_PATTERN.test(repository.name) &&
  typeof repository.ref === "string" &&
  PINNED_REF_PATTERN.test(repository.ref) &&
  typeof repository.rootDir === "string" &&
  repository.rootDir.length > 0 &&
  !UNSAFE_ROOT_DIRECTORY_PATTERN.test(repository.rootDir) &&
  !posix.isAbsolute(repository.rootDir) &&
  posix.normalize(repository.rootDir) === repository.rootDir &&
  repository.rootDir !== ".." &&
  !repository.rootDir.startsWith("../");

export const validateEvalRecord = (record) =>
  isRecord(record) &&
  record.schemaVersion === PARITY_SCHEMA_VERSION &&
  validateRepository(record.repository);

const normalizePath = (filePath) => {
  const normalizedPath = posix.normalize(filePath.replaceAll("\\", "/"));
  return normalizedPath === "." ? "" : normalizedPath.replace(/^\.\//, "");
};

const isAbsolutePath = (filePath) => filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath);

const resolvePath = (basePath, filePath) => {
  const normalizedFilePath = normalizePath(filePath);
  if (isAbsolutePath(normalizedFilePath)) return normalizedFilePath;
  return normalizePath(`${normalizePath(basePath)}/${normalizedFilePath}`);
};

const relativePath = (basePath, filePath) => {
  const normalizedBasePath = normalizePath(basePath);
  const normalizedFilePath = normalizePath(filePath);
  const relativeFilePath = posix.relative(normalizedBasePath, normalizedFilePath);
  return normalizePath(relativeFilePath);
};

const getProjectRoot = (report, project) => {
  const configuredRoot =
    report.schemaVersion === 3
      ? project.packageRoot
      : isRecord(project.project) && typeof project.project.rootDirectory === "string"
        ? project.project.rootDirectory
        : project.directory;
  return resolvePath(report.directory, configuredRoot);
};

const getCanonicalDiagnosticPath = (report, project, diagnostic) => {
  const projectRoot = getProjectRoot(report, project);
  const diagnosticPath =
    typeof diagnostic.normalizedFilePath === "string"
      ? resolvePath(projectRoot, diagnostic.normalizedFilePath)
      : resolvePath(projectRoot, diagnostic.filePath);
  return relativePath(report.directory, diagnosticPath);
};

const optionalProperty = (name, value) => (value === undefined ? {} : { [name]: value });

const canonicalRelatedLocation = (report, project, location) => {
  const projectRoot = getProjectRoot(report, project);
  return {
    filePath: relativePath(report.directory, resolvePath(projectRoot, location.filePath)),
    line: location.line,
    column: location.column,
    ...optionalProperty("offset", location.offset),
    ...optionalProperty("length", location.length),
    ...optionalProperty("endLine", location.endLine),
    ...optionalProperty("endColumn", location.endColumn),
    message: location.message,
  };
};

const canonicalDiagnostic = (report, project, diagnostic) => ({
  filePath: getCanonicalDiagnosticPath(report, project, diagnostic),
  plugin: diagnostic.plugin,
  rule: diagnostic.rule,
  severity: diagnostic.severity,
  ...optionalProperty("title", diagnostic.title),
  message: diagnostic.message,
  help: diagnostic.help,
  ...optionalProperty("url", diagnostic.url),
  line: diagnostic.line,
  column: diagnostic.column,
  ...optionalProperty("offset", diagnostic.offset),
  ...optionalProperty("length", diagnostic.length),
  ...optionalProperty("endLine", diagnostic.endLine),
  ...optionalProperty("endColumn", diagnostic.endColumn),
  category: diagnostic.category,
  tags: [...(diagnostic.tags ?? [])].sort(compareStrings),
  ...optionalProperty("matchByOccurrence", diagnostic.matchByOccurrence),
  ...optionalProperty("fileContext", diagnostic.fileContext),
  ...optionalProperty("suppressionHint", diagnostic.suppressionHint),
  ...optionalProperty(
    "relatedLocations",
    diagnostic.relatedLocations?.map((location) =>
      canonicalRelatedLocation(report, project, location),
    ),
  ),
  ...optionalProperty("fixGroupId", diagnostic.fixGroupId),
});

const diagnosticKey = (report, project, diagnostic) =>
  JSON.stringify(canonicalDiagnostic(report, project, diagnostic));

export const diagnosticRuleKey = (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`;

const isOptionalFiniteNumber = (value) =>
  value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);

const isOptionalString = (value) => value === undefined || typeof value === "string";

const validateRelatedLocation = (location) =>
  isRecord(location) &&
  typeof location.filePath === "string" &&
  typeof location.line === "number" &&
  Number.isFinite(location.line) &&
  location.line >= 0 &&
  typeof location.column === "number" &&
  Number.isFinite(location.column) &&
  location.column >= 0 &&
  isOptionalFiniteNumber(location.offset) &&
  isOptionalFiniteNumber(location.length) &&
  isOptionalFiniteNumber(location.endLine) &&
  isOptionalFiniteNumber(location.endColumn) &&
  typeof location.message === "string";

const validateDiagnostic = (diagnostic, reportSchemaVersion) =>
  isRecord(diagnostic) &&
  typeof diagnostic.filePath === "string" &&
  typeof diagnostic.line === "number" &&
  Number.isFinite(diagnostic.line) &&
  diagnostic.line >= 0 &&
  typeof diagnostic.column === "number" &&
  Number.isFinite(diagnostic.column) &&
  diagnostic.column >= 0 &&
  typeof diagnostic.plugin === "string" &&
  typeof diagnostic.rule === "string" &&
  (diagnostic.severity === "error" || diagnostic.severity === "warning") &&
  typeof diagnostic.message === "string" &&
  typeof diagnostic.help === "string" &&
  typeof diagnostic.category === "string" &&
  isOptionalString(diagnostic.title) &&
  isOptionalString(diagnostic.url) &&
  isOptionalFiniteNumber(diagnostic.offset) &&
  isOptionalFiniteNumber(diagnostic.length) &&
  isOptionalFiniteNumber(diagnostic.endLine) &&
  isOptionalFiniteNumber(diagnostic.endColumn) &&
  (diagnostic.matchByOccurrence === undefined ||
    typeof diagnostic.matchByOccurrence === "boolean") &&
  (diagnostic.fileContext === undefined ||
    diagnostic.fileContext === "test" ||
    diagnostic.fileContext === "story") &&
  isOptionalString(diagnostic.suppressionHint) &&
  (diagnostic.relatedLocations === undefined ||
    (Array.isArray(diagnostic.relatedLocations) &&
      diagnostic.relatedLocations.every(validateRelatedLocation))) &&
  isOptionalString(diagnostic.fixGroupId) &&
  (reportSchemaVersion !== 3 ||
    (typeof diagnostic.id === "string" &&
      typeof diagnostic.normalizedFilePath === "string" &&
      Array.isArray(diagnostic.tags) &&
      diagnostic.tags.every((tag) => typeof tag === "string")));

const validateSummary = (summary, diagnostics) => {
  if (!isRecord(summary)) return false;
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  return (
    summary.errorCount === errorCount &&
    summary.warningCount === warningCount &&
    Number.isInteger(summary.affectedFileCount) &&
    summary.affectedFileCount >= 0 &&
    summary.totalDiagnosticCount === diagnostics.length &&
    (summary.score === null ||
      (typeof summary.score === "number" && Number.isFinite(summary.score))) &&
    (summary.scoreLabel === null || typeof summary.scoreLabel === "string")
  );
};

const validateDiff = (diff) =>
  diff === null ||
  (isRecord(diff) &&
    typeof diff.baseBranch === "string" &&
    (diff.currentBranch === null || typeof diff.currentBranch === "string") &&
    Number.isInteger(diff.changedFileCount) &&
    diff.changedFileCount >= 0 &&
    typeof diff.isCurrentChanges === "boolean");

const validateBaseline = (baseline) =>
  isRecord(baseline) &&
  typeof baseline.baseRef === "string" &&
  Number.isInteger(baseline.newCount) &&
  baseline.newCount >= 0 &&
  Number.isInteger(baseline.fixedCount) &&
  baseline.fixedCount >= 0 &&
  Number.isInteger(baseline.baseTotalCount) &&
  baseline.baseTotalCount >= 0;

const validateSkippedCheckReasons = (skippedCheckReasons) =>
  skippedCheckReasons === undefined ||
  (isRecord(skippedCheckReasons) &&
    Object.values(skippedCheckReasons).every((reason) => typeof reason === "string"));

const validateReport = (report) => {
  if (
    !isRecord(report) ||
    !REPORT_SCHEMA_VERSIONS.has(report.schemaVersion) ||
    report.ok !== true ||
    typeof report.version !== "string" ||
    typeof report.directory !== "string" ||
    !REPORT_MODES.has(report.mode) ||
    !Object.hasOwn(report, "diff") ||
    !validateDiff(report.diff) ||
    !Array.isArray(report.projects) ||
    report.projects.length === 0 ||
    !Array.isArray(report.diagnostics) ||
    !report.diagnostics.every((diagnostic) =>
      validateDiagnostic(diagnostic, report.schemaVersion),
    ) ||
    !validateSummary(report.summary, report.diagnostics) ||
    typeof report.elapsedMilliseconds !== "number" ||
    !Number.isFinite(report.elapsedMilliseconds) ||
    report.elapsedMilliseconds < 0 ||
    report.error !== null
  ) {
    return "Invalid or incomplete report schema";
  }
  if (report.schemaVersion === 2 && !validateBaseline(report.baseline)) {
    return "Invalid or missing v2 baseline data";
  }
  if (
    report.schemaVersion === 3 &&
    report.baseline !== undefined &&
    !validateBaseline(report.baseline)
  ) {
    return "Invalid v3 baseline data";
  }

  const projectDiagnostics = [];
  let incompleteProjectCount = 0;
  for (const project of report.projects) {
    if (
      !isRecord(project) ||
      typeof project.directory !== "string" ||
      !Array.isArray(project.diagnostics) ||
      !project.diagnostics.every((diagnostic) =>
        validateDiagnostic(diagnostic, report.schemaVersion),
      ) ||
      !Array.isArray(project.skippedChecks) ||
      !project.skippedChecks.every((check) => typeof check === "string") ||
      !validateSkippedCheckReasons(project.skippedCheckReasons) ||
      !Object.hasOwn(project, "project") ||
      !Object.hasOwn(project, "score") ||
      (project.scannedFileCount !== undefined &&
        (!Number.isInteger(project.scannedFileCount) || project.scannedFileCount < 0)) ||
      typeof project.elapsedMilliseconds !== "number" ||
      !Number.isFinite(project.elapsedMilliseconds) ||
      project.elapsedMilliseconds < 0
    ) {
      return "Invalid or incomplete project report schema";
    }
    const skippedCheckReasonCount = Object.keys(project.skippedCheckReasons ?? {}).length;
    if (report.schemaVersion === 3) {
      if (
        typeof project.packageRoot !== "string" ||
        typeof project.framework !== "string" ||
        !REPORT_FRAMEWORKS.has(project.framework) ||
        !Array.isArray(project.analyzedFiles) ||
        !project.analyzedFiles.every((filePath) => typeof filePath === "string") ||
        !Number.isInteger(project.analyzedFileCount) ||
        project.analyzedFileCount !== project.analyzedFiles.length ||
        typeof project.complete !== "boolean"
      ) {
        return "Invalid or missing v3 project completion data";
      }
      const hasInvalidScannedFileCount =
        project.scannedFileCount !== undefined &&
        (!Number.isInteger(project.scannedFileCount) ||
          project.scannedFileCount < 0 ||
          project.scannedFileCount !== project.analyzedFileCount);
      if (
        !project.complete ||
        project.skippedChecks.length > 0 ||
        skippedCheckReasonCount > 0 ||
        hasInvalidScannedFileCount
      ) {
        incompleteProjectCount += 1;
      }
    } else if (project.skippedChecks.length > 0 || skippedCheckReasonCount > 0) {
      incompleteProjectCount += 1;
    }
    projectDiagnostics.push(...project.diagnostics);
  }

  if (incompleteProjectCount > 0) {
    return `${incompleteProjectCount} project report${incompleteProjectCount === 1 ? " is" : "s are"} incomplete`;
  }
  if (!isDeepStrictEqual(projectDiagnostics, report.diagnostics)) {
    return "Flattened diagnostics do not match project diagnostics";
  }
  return null;
};

const canonicalCoverageFilePath = (report, project, filePath) =>
  relativePath(report.directory, resolvePath(getProjectRoot(report, project), filePath));

export const coverageFingerprint = (record) => {
  if (!record.report || record.report.schemaVersion !== 3) return null;
  const report = record.report;
  const projects = report.projects
    .map((project) => ({
      directory: relativePath(report.directory, resolvePath(report.directory, project.directory)),
      packageRoot: relativePath(
        report.directory,
        resolvePath(report.directory, project.packageRoot),
      ),
      framework: project.framework,
      analyzedFiles: project.analyzedFiles
        .map((filePath) => canonicalCoverageFilePath(report, project, filePath))
        .sort(compareStrings),
      analyzedFileCount: project.analyzedFileCount,
      ...optionalProperty("scannedFileCount", project.scannedFileCount),
    }))
    .sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)));
  return JSON.stringify({
    reactDetected: report.reactDetected ?? null,
    projects,
  });
};

export const readRun = async (filePath, onRecord) => {
  const lines = createInterface({ input: createReadStream(filePath) });
  let lineNumber = 0;
  let recordCount = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`${filePath}:${lineNumber} is not valid JSON`);
    }
    if (!validateEvalRecord(record)) {
      throw new Error(`${filePath}:${lineNumber} is not a complete eval schema v1 record`);
    }
    await onRecord(record, projectKey(record.repository), line);
    recordCount += 1;
  }
  return recordCount;
};

const baselineRecordPath = (temporaryDirectory, key) =>
  join(
    temporaryDirectory,
    `${createHash("sha256").update(key).digest("hex")}${BASELINE_RECORD_FILE_SUFFIX}`,
  );

const isInvariantDiagnostic = (diagnostic) =>
  diagnostic.plugin === INVARIANT_DIAGNOSTIC_PLUGIN ||
  INVARIANT_DIAGNOSTIC_RULE_KEYS.has(diagnosticRuleKey(diagnostic));

export const diagnosticsByIdentity = (record, rejectOutsideRuleScope, selectedRuleKeys = null) => {
  if (Object.hasOwn(record, "error")) {
    if (
      typeof record.error !== "string" ||
      record.error.length === 0 ||
      record.report !== undefined
    ) {
      return { error: "Invalid evaluation error record" };
    }
    return { error: record.error };
  }
  const reportError = validateReport(record.report);
  if (reportError) return { error: reportError };

  const diagnostics = new Map();
  for (const project of record.report.projects) {
    for (const diagnostic of project.diagnostics) {
      const ruleKey = diagnosticRuleKey(diagnostic);
      if (
        selectedRuleKeys &&
        !selectedRuleKeys.has(ruleKey) &&
        !isInvariantDiagnostic(diagnostic)
      ) {
        if (rejectOutsideRuleScope) {
          return { error: `Candidate emitted diagnostic outside rule scope: ${ruleKey}` };
        }
        continue;
      }
      const identity = diagnosticKey(record.report, project, diagnostic);
      const occurrences = diagnostics.get(identity) ?? [];
      occurrences.push(diagnostic);
      diagnostics.set(identity, occurrences);
    }
  }
  for (const occurrences of diagnostics.values()) {
    occurrences.sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)));
  }
  return { diagnostics };
};

export const diagnosticCount = (diagnostics) => {
  let count = 0;
  for (const occurrences of diagnostics.values()) count += occurrences.length;
  return count;
};

const summarizeRules = (entries) => {
  const counts = new Map();
  for (const entry of entries) {
    const rule = `${entry.diagnostic.plugin}/${entry.diagnostic.rule}`;
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return Array.from(counts, ([rule, count]) => ({ rule, count })).sort(
    (left, right) => right.count - left.count || compareStrings(left.rule, right.rule),
  );
};

const compareDiagnosticEntries = (left, right) =>
  compareStrings(projectKey(left.repository), projectKey(right.repository)) ||
  compareStrings(left.identity, right.identity) ||
  compareStrings(JSON.stringify(left.diagnostic), JSON.stringify(right.diagnostic));

const compareSkippedProjects = (left, right) =>
  compareStrings(projectKey(left.repository), projectKey(right.repository)) ||
  compareStrings(left.baselineError ?? "", right.baselineError ?? "") ||
  compareStrings(left.candidateError ?? "", right.candidateError ?? "");

const buildDiagnosticEntry = (repository, identity, diagnostic) => {
  const entry = { repository, diagnostic };
  Object.defineProperty(entry, "identity", { value: identity });
  return entry;
};

const writeOutputChunk = async (chunk) => {
  if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
};

const formatNestedJson = (value, indentationSpaces) =>
  JSON.stringify(value, undefined, JSON_INDENT_SPACES).replaceAll(
    "\n",
    `\n${" ".repeat(indentationSpaces)}`,
  );

const writeOutputProperty = async (name, value) => {
  await writeOutputChunk(`  ${JSON.stringify(name)}: ${formatNestedJson(value, 2)},\n`);
};

const writeOutputArray = async (name, entries, hasFollowingProperty) => {
  await writeOutputChunk(`  ${JSON.stringify(name)}: [`);
  for (const [entryIndex, entry] of entries.entries()) {
    const separator = entryIndex === 0 ? "\n" : ",\n";
    await writeOutputChunk(`${separator}    ${formatNestedJson(entry, 4)}`);
  }
  const closingPrefix = entries.length === 0 ? "" : "\n";
  await writeOutputChunk(`${closingPrefix}  ]${hasFollowingProperty ? "," : ""}\n`);
};

const compareParity = async ({ baselinePath, candidatePath, selectedRuleKeys = null }) => {
  try {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-parity-"));
    const added = [];
    const removed = [];
    const skippedProjects = [];
    let unchangedCount = 0;
    let baselineDiagnosticCount = 0;
    let candidateDiagnosticCount = 0;
    let comparedProjectCount = 0;

    const compareRecords = (baselineRecord, candidateRecord) => {
      const repository = candidateRecord?.repository ?? baselineRecord?.repository;
      const baseline = baselineRecord
        ? diagnosticsByIdentity(baselineRecord, false, selectedRuleKeys)
        : { error: "Missing baseline record" };
      const candidate = candidateRecord
        ? diagnosticsByIdentity(candidateRecord, true, selectedRuleKeys)
        : { error: "Missing candidate record" };

      if (baseline.error || candidate.error) {
        skippedProjects.push({
          repository,
          baselineError: baseline.error,
          candidateError: candidate.error,
        });
        return;
      }

      const baselineCoverageFingerprint = baselineRecord
        ? coverageFingerprint(baselineRecord)
        : null;
      const candidateCoverageFingerprint = candidateRecord
        ? coverageFingerprint(candidateRecord)
        : null;
      if (
        selectedRuleKeys !== null &&
        (baselineCoverageFingerprint === null || candidateCoverageFingerprint === null)
      ) {
        skippedProjects.push({
          repository,
          baselineError:
            baselineCoverageFingerprint === null
              ? "Scoped parity requires v3 project coverage"
              : null,
          candidateError:
            candidateCoverageFingerprint === null
              ? "Scoped parity requires v3 project coverage"
              : null,
        });
        return;
      }
      if (
        baselineCoverageFingerprint !== null &&
        candidateCoverageFingerprint !== null &&
        baselineCoverageFingerprint !== candidateCoverageFingerprint
      ) {
        skippedProjects.push({
          repository,
          baselineError: "Project coverage differs from candidate",
          candidateError: "Project coverage differs from baseline",
        });
        return;
      }

      comparedProjectCount += 1;
      baselineDiagnosticCount += diagnosticCount(baseline.diagnostics);
      candidateDiagnosticCount += diagnosticCount(candidate.diagnostics);

      const identities = new Set([...baseline.diagnostics.keys(), ...candidate.diagnostics.keys()]);
      for (const identity of identities) {
        const baselineDiagnostics = baseline.diagnostics.get(identity) ?? [];
        const candidateDiagnostics = candidate.diagnostics.get(identity) ?? [];
        const matchingCount = Math.min(baselineDiagnostics.length, candidateDiagnostics.length);
        unchangedCount += matchingCount;
        for (
          let occurrenceIndex = matchingCount;
          occurrenceIndex < baselineDiagnostics.length;
          occurrenceIndex += 1
        ) {
          removed.push(
            buildDiagnosticEntry(
              repository,
              JSON.stringify([identity, occurrenceIndex]),
              baselineDiagnostics[occurrenceIndex],
            ),
          );
        }
        for (
          let occurrenceIndex = matchingCount;
          occurrenceIndex < candidateDiagnostics.length;
          occurrenceIndex += 1
        ) {
          added.push(
            buildDiagnosticEntry(
              repository,
              JSON.stringify([identity, occurrenceIndex]),
              candidateDiagnostics[occurrenceIndex],
            ),
          );
        }
      }
    };

    let baselineProjectCount;
    let candidateProjectCount;
    try {
      baselineProjectCount = await readRun(baselinePath, (record, key, line) => {
        const recordPath = baselineRecordPath(temporaryDirectory, key);
        if (existsSync(recordPath)) {
          throw new Error(`${baselinePath} contains duplicate project ${key}`);
        }
        writeFileSync(recordPath, line);
      });

      const candidateKeys = new Set();
      candidateProjectCount = await readRun(candidatePath, (candidateRecord, key) => {
        if (candidateKeys.has(key)) {
          throw new Error(`${candidatePath} contains duplicate project ${key}`);
        }
        candidateKeys.add(key);
        const recordPath = baselineRecordPath(temporaryDirectory, key);
        if (!existsSync(recordPath)) {
          compareRecords(undefined, candidateRecord);
          return;
        }
        const baselineRecord = JSON.parse(readFileSync(recordPath, "utf8"));
        unlinkSync(recordPath);
        compareRecords(baselineRecord, candidateRecord);
      });

      if (baselineProjectCount === 0 || candidateProjectCount === 0) {
        throw new Error("Parity inputs must each contain at least one eval record");
      }

      for (const fileName of readdirSync(temporaryDirectory).sort(compareStrings)) {
        if (!fileName.endsWith(BASELINE_RECORD_FILE_SUFFIX)) continue;
        const recordPath = join(temporaryDirectory, fileName);
        compareRecords(JSON.parse(readFileSync(recordPath, "utf8")), undefined);
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }

    added.sort(compareDiagnosticEntries);
    removed.sort(compareDiagnosticEntries);
    skippedProjects.sort(compareSkippedProjects);
    const summary = {
      baselineProjects: baselineProjectCount,
      candidateProjects: candidateProjectCount,
      comparedProjects: comparedProjectCount,
      skippedProjects: skippedProjects.length,
      baselineDiagnostics: baselineDiagnosticCount,
      candidateDiagnostics: candidateDiagnosticCount,
      added: added.length,
      removed: removed.length,
      unchanged: unchangedCount,
    };
    const rules = {
      added: summarizeRules(added),
      removed: summarizeRules(removed),
    };

    await writeOutputChunk("{\n");
    await writeOutputProperty("schemaVersion", PARITY_SCHEMA_VERSION);
    if (selectedRuleKeys) {
      await writeOutputProperty("ruleScope", [...selectedRuleKeys].sort(compareStrings));
      await writeOutputProperty("invariantRuleScope", [
        TYPESCRIPT_INVARIANT_RULE_SCOPE,
        ...[...INVARIANT_DIAGNOSTIC_RULE_KEYS].sort(compareStrings),
      ]);
    }
    await writeOutputProperty("summary", summary);
    await writeOutputProperty("rules", rules);
    await writeOutputArray("added", added, true);
    await writeOutputArray("removed", removed, true);
    await writeOutputArray("skippedProjects", skippedProjects, false);
    await writeOutputChunk("}\n");
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
};

const runCli = async () => {
  const comparisonArguments = process.argv.slice(2);
  const hasRuleScope =
    comparisonArguments.length === SCOPED_ARGUMENT_COUNT && comparisonArguments[0] === "--rules";
  const [baselinePath, candidatePath] = hasRuleScope
    ? comparisonArguments.slice(2)
    : comparisonArguments;

  if (
    (!hasRuleScope && comparisonArguments.length !== EXPECTED_ARGUMENT_COUNT) ||
    (hasRuleScope && (!baselinePath || !candidatePath))
  ) {
    process.stderr.write(
      "Usage: compare-parity.mjs [--rules <rules.json>] <baseline.ndjson> <candidate.ndjson>\n",
    );
    process.exitCode = INVALID_INPUT_EXIT_CODE;
    return;
  }

  try {
    const selectedRuleKeys = loadSelectedRuleKeys(
      hasRuleScope ? comparisonArguments[1] : undefined,
    );
    await compareParity({ baselinePath, candidatePath, selectedRuleKeys });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = INVALID_INPUT_EXIT_CODE;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolveFileSystemPath(process.argv[1])) {
  await runCli();
}
