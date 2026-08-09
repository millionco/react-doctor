import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const HASH_PREFIX_LENGTH = 12;
const COMPLETE_SOURCE_START_LINE = 1;
const CORPUS_DIRECTORY_NAME = "react-bench-0.9.7-audit";
const DEFAULT_AUDIT_VERSION = "0.9.7";
const TRUE_POSITIVE_SUFFIXES = new Set(["2JPrD6x", "SQSmbFe", "eGYGezE", "p9AQ8ui"]);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const collectFiles = (directory) => {
  const filePaths = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) filePaths.push(...collectFiles(entryPath));
    else if (entry.isFile()) filePaths.push(entryPath);
  }
  return filePaths;
};

const toKebabCase = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const resolveSource = (callsite, currentSourcesDirectory) => {
  const suffixDirectory = path.join(currentSourcesDirectory, callsite.suffix);
  if (fs.existsSync(suffixDirectory)) {
    const exactCandidates = [callsite.reconstructedFilePath, callsite.reportedFilePath]
      .filter(Boolean)
      .map((relativePath) => path.join(suffixDirectory, relativePath));
    for (const candidate of exactCandidates) {
      if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
    }

    const baseNames = new Set(
      exactCandidates.map((candidate) => path.basename(candidate)).filter(Boolean),
    );
    const matchingSources = collectFiles(suffixDirectory)
      .filter((filePath) => baseNames.has(path.basename(filePath)))
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .filter((source) => source.includes(callsite.snippet));
    if (matchingSources.length === 1) return matchingSources[0];
  }

  const snippetLineCount = callsite.snippet.split("\n").length;
  const isCompleteSource =
    callsite.snippetStartLine === COMPLETE_SOURCE_START_LINE &&
    callsite.snippetEndLine === snippetLineCount &&
    sha256(callsite.snippet) === callsite.sourceSha256;
  if (isCompleteSource) return callsite.snippet;

  throw new Error(
    `Unable to resolve exact source for ${callsite.suffix}:${callsite.reportedFilePath}`,
  );
};

const chooseExtension = (callsitePaths) => {
  const extensions = callsitePaths.map((filePath) => path.extname(filePath).toLowerCase());
  for (const extension of [".tsx", ".jsx", ".ts", ".js"]) {
    if (extensions.includes(extension)) return extension;
  }
  throw new Error(`Unsupported source extensions: ${extensions.join(", ")}`);
};

const main = () => {
  const [contextsPath, currentSourcesDirectory, corpusDirectory, manifestPath] =
    process.argv.slice(2);
  if (!contextsPath || !currentSourcesDirectory || !corpusDirectory || !manifestPath) {
    throw new Error(
      "Usage: node import-react-bench-audit-corpus.mjs <contexts.json> <current-sources> <corpus-directory> <manifest.json>",
    );
  }
  const resolvedCorpusDirectory = path.resolve(corpusDirectory);
  if (path.basename(resolvedCorpusDirectory) !== CORPUS_DIRECTORY_NAME) {
    throw new Error(`Refusing to replace unexpected corpus directory ${resolvedCorpusDirectory}`);
  }

  const callsites = JSON.parse(fs.readFileSync(contextsPath, "utf8")).sort((left, right) =>
    [left.suffix, left.rule, left.reconstructedFilePath, left.reportedLine]
      .join(":")
      .localeCompare(
        [right.suffix, right.rule, right.reconstructedFilePath, right.reportedLine].join(":"),
      ),
  );
  const callsiteKeys = callsites.map((callsite) =>
    [
      callsite.suffix,
      callsite.rule,
      callsite.reconstructedFilePath,
      callsite.reportedLine,
      callsite.reportedColumn ?? "",
      callsite.snippetSha256,
    ].join(":"),
  );
  if (new Set(callsiteKeys).size !== callsiteKeys.length) {
    throw new Error("Duplicate audited callsite instances");
  }

  const fixtureGroups = new Map();
  for (const callsite of callsites) {
    const source = resolveSource(callsite, currentSourcesDirectory);
    if (!source.includes(callsite.snippet)) {
      throw new Error(`Resolved source omits callsite snippet for ${callsite.suffix}`);
    }
    const fixtureSourceSha256 = sha256(source);
    const verdict = TRUE_POSITIVE_SUFFIXES.has(callsite.suffix) ? "fail" : "pass";
    const existingGroup = fixtureGroups.get(fixtureSourceSha256);
    if (existingGroup && existingGroup.verdict !== verdict) {
      throw new Error(`Conflicting verdicts for source ${fixtureSourceSha256}`);
    }
    const group = existingGroup ?? {
      source,
      verdict,
      rules: new Set(),
      auditVersions: new Set(),
      callsitePaths: [],
      callsites: [],
    };
    group.rules.add(callsite.rule);
    group.auditVersions.add(callsite.auditVersion ?? DEFAULT_AUDIT_VERSION);
    group.callsitePaths.push(callsite.reconstructedFilePath || callsite.reportedFilePath);
    group.callsites.push(callsite);
    fixtureGroups.set(fixtureSourceSha256, group);
  }

  fs.rmSync(resolvedCorpusDirectory, { recursive: true, force: true });
  fs.mkdirSync(resolvedCorpusDirectory, { recursive: true });

  const fixtureByCallsiteKey = new Map();
  const fixtures = [];
  for (const [fixtureSourceSha256, group] of [...fixtureGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const extension = chooseExtension(group.callsitePaths);
    const sourceBaseName = toKebabCase(
      path.basename(group.callsitePaths[0], path.extname(group.callsitePaths[0])),
    );
    const directoryName = group.verdict === "pass" ? "regressions" : "true-positives";
    const fileName = `${fixtureSourceSha256.slice(0, HASH_PREFIX_LENGTH)}--${sourceBaseName}${extension}`;
    const relativePath = path.posix.join(CORPUS_DIRECTORY_NAME, directoryName, fileName);
    const outputPath = path.join(resolvedCorpusDirectory, directoryName, fileName);
    const rules = [...group.rules].sort();
    const header = [
      `// rule: ${rules.join(", ")}`,
      `// file-path: ${group.callsitePaths[0]}`,
      group.verdict === "fail" ? "// verdict: fail" : "// audit-verdict: pass",
      "// weakness: react-bench-exact-callsite",
      `// source: React Bench ${[...group.auditVersions].sort().join("+")} exhaustive audit ${fixtureSourceSha256}`,
    ].join("\n");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${header}\n${group.source}`);
    fixtures.push({
      fixture: relativePath,
      filePath: group.callsitePaths[0],
      verdict: group.verdict,
      rules,
      fixtureSourceSha256,
    });
    for (const callsite of group.callsites) {
      const callsiteKey = [
        callsite.suffix,
        callsite.rule,
        callsite.reconstructedFilePath,
        callsite.reportedLine,
        callsite.reportedColumn ?? "",
        callsite.snippetSha256,
      ].join(":");
      fixtureByCallsiteKey.set(callsiteKey, relativePath);
    }
  }

  const manifestCallsites = callsites.map((callsite) => {
    const callsiteKey = [
      callsite.suffix,
      callsite.rule,
      callsite.reconstructedFilePath,
      callsite.reportedLine,
      callsite.snippetSha256,
    ].join(":");
    return {
      suffix: callsite.suffix,
      ...(callsite.sourceTrialId ? { sourceTrialId: callsite.sourceTrialId } : {}),
      auditVersion: callsite.auditVersion ?? DEFAULT_AUDIT_VERSION,
      task: callsite.task,
      patchSha256: callsite.patchSha256,
      rule: callsite.rule,
      filePath: callsite.reconstructedFilePath || callsite.reportedFilePath,
      reportedLine: callsite.reportedLine,
      ...(callsite.reportedColumn ? { reportedColumn: callsite.reportedColumn } : {}),
      sourceSha256: callsite.sourceSha256,
      snippetSha256: callsite.snippetSha256,
      fixture: fixtureByCallsiteKey.get(callsiteKey),
      verdict: TRUE_POSITIVE_SUFFIXES.has(callsite.suffix) ? "fail" : "pass",
    };
  });
  const manifest = {
    source: `React Bench ${[...new Set(manifestCallsites.map((callsite) => callsite.auditVersion))]
      .sort()
      .join("+")} exhaustive all-diffs audit`,
    expected: {
      totalCallsites: manifestCallsites.length,
      passCallsites: manifestCallsites.filter((callsite) => callsite.verdict === "pass").length,
      failCallsites: manifestCallsites.filter((callsite) => callsite.verdict === "fail").length,
      uniqueTrials: new Set(manifestCallsites.map((callsite) => callsite.suffix)).size,
      uniqueFixtures: fixtures.length,
    },
    fixtures,
    callsites: manifestCallsites,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

main();
