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
import { join, posix } from "node:path";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";

const PARITY_SCHEMA_VERSION = 1;
const PARITY_DIFFERENCE_EXIT_CODE = 1;
const INVALID_INPUT_EXIT_CODE = 2;
const JSON_INDENT_SPACES = 2;
const EXPECTED_ARGUMENT_COUNT = 2;
const BASELINE_RECORD_FILE_SUFFIX = ".json";
const PINNED_REF_PATTERN = /^[0-9a-f]{40}$/i;
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
  "unknown",
]);
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+$/;
const UNSAFE_ROOT_DIRECTORY_PATTERN = /["'`$;&|<>\\\r\n]/;

const [baselinePath, candidatePath] = process.argv.slice(2);

if (process.argv.slice(2).length !== EXPECTED_ARGUMENT_COUNT) {
  process.stderr.write("Usage: compare-parity.mjs <baseline.ndjson> <candidate.ndjson>\n");
  process.exit(INVALID_INPUT_EXIT_CODE);
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const compareStrings = (left, right) => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const projectKey = (repository) =>
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

const validateEvalRecord = (record) =>
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

const diagnosticKey = (report, project, diagnostic) =>
  JSON.stringify([
    getCanonicalDiagnosticPath(report, project, diagnostic),
    diagnostic.line,
    diagnostic.column,
    diagnostic.plugin,
    diagnostic.rule,
    diagnostic.severity,
    diagnostic.message,
  ]);

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

const readRun = async (filePath, onRecord) => {
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

const addCanonicalDiagnostic = (diagnostics, identity, diagnostic) => {
  const existingDiagnostic = diagnostics.get(identity);
  if (
    !existingDiagnostic ||
    compareStrings(JSON.stringify(diagnostic), JSON.stringify(existingDiagnostic)) < 0
  ) {
    diagnostics.set(identity, diagnostic);
  }
};

const diagnosticsByIdentity = (record) => {
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
      addCanonicalDiagnostic(
        diagnostics,
        diagnosticKey(record.report, project, diagnostic),
        diagnostic,
      );
    }
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
      return;
    }

    comparedProjectCount += 1;
    baselineDiagnosticCount += baseline.diagnostics.size;
    candidateDiagnosticCount += candidate.diagnostics.size;

    const identities = new Set([...baseline.diagnostics.keys(), ...candidate.diagnostics.keys()]);
    for (const identity of identities) {
      const baselineDiagnostic = baseline.diagnostics.get(identity);
      const candidateDiagnostic = candidate.diagnostics.get(identity);
      if (baselineDiagnostic && candidateDiagnostic) {
        unchangedCount += 1;
      } else if (baselineDiagnostic) {
        removed.push(buildDiagnosticEntry(repository, identity, baselineDiagnostic));
      } else if (candidateDiagnostic) {
        added.push(buildDiagnosticEntry(repository, identity, candidateDiagnostic));
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
