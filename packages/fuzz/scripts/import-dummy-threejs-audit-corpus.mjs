import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const CORPUS_DIRECTORY_NAME = "dummy-threejs-v14-audit";
const HASH_PREFIX_LENGTH = 12;
const TASK_PATH_PATTERN = /[/\\]tasks[/\\]([^/\\]+)[/\\]solution[/\\](?:files|source)$/;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const toKebabCase = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const parseDiagnostics = (diagnosticsPath) =>
  fs
    .readFileSync(diagnosticsPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sourceRoot, filePath, lineText, columnText, rule, ...messageParts] = line.split("\t");
      if (!sourceRoot || !filePath || !lineText || !columnText || !rule || !messageParts.length) {
        throw new Error(`Invalid diagnostic row in ${diagnosticsPath}: ${line}`);
      }
      const reportedLine = Number(lineText);
      const reportedColumn = Number(columnText);
      if (!Number.isInteger(reportedLine) || !Number.isInteger(reportedColumn)) {
        throw new Error(`Invalid diagnostic location in ${diagnosticsPath}: ${line}`);
      }
      const project = TASK_PATH_PATTERN.exec(sourceRoot)?.[1];
      if (!project) throw new Error(`Unable to resolve Dummy project from ${sourceRoot}`);
      return {
        sourceRoot,
        project,
        filePath,
        reportedLine,
        reportedColumn,
        rule,
        message: messageParts.join("\t"),
        diagnosticRow: line,
        diagnosticKey: [sourceRoot, filePath, reportedLine, reportedColumn, rule].join("\t"),
      };
    });

const readAuditedProjects = (selectedRootsPath) => {
  const selectedRoots = fs.readFileSync(selectedRootsPath, "utf8").split("\n").filter(Boolean);
  const projectIds = selectedRoots.map((sourceRoot) => {
    const project = TASK_PATH_PATTERN.exec(sourceRoot)?.[1];
    if (!project) throw new Error(`Unable to resolve Dummy project from ${sourceRoot}`);
    return project;
  });
  if (new Set(projectIds).size !== projectIds.length) {
    throw new Error("Selected Dummy roots contain duplicate projects");
  }
  return projectIds.sort();
};

const resolveSource = (diagnostic) => {
  const sourcePath = path.resolve(diagnostic.sourceRoot, diagnostic.filePath);
  const relativePath = path.relative(path.resolve(diagnostic.sourceRoot), sourcePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Diagnostic source escapes its project root: ${sourcePath}`);
  }
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing Dummy source: ${sourcePath}`);
  return fs.readFileSync(sourcePath, "utf8");
};

const chooseExtension = (filePaths) => {
  const extensions = filePaths.map((filePath) => path.extname(filePath).toLowerCase());
  for (const extension of [".tsx", ".jsx", ".ts", ".js"]) {
    if (extensions.includes(extension)) return extension;
  }
  throw new Error(`Unsupported source extensions: ${extensions.join(", ")}`);
};

const main = () => {
  const [
    beforeDiagnosticsPath,
    afterDiagnosticsPath,
    selectedRootsPath,
    corpusDirectory,
    manifestPath,
  ] = process.argv.slice(2);
  if (
    !beforeDiagnosticsPath ||
    !afterDiagnosticsPath ||
    !selectedRootsPath ||
    !corpusDirectory ||
    !manifestPath
  ) {
    throw new Error(
      "Usage: node import-dummy-threejs-audit-corpus.mjs <before.tsv> <after.tsv> <selected-roots.txt> <corpus-directory> <manifest.json>",
    );
  }

  const resolvedCorpusDirectory = path.resolve(corpusDirectory);
  if (path.basename(resolvedCorpusDirectory) !== CORPUS_DIRECTORY_NAME) {
    throw new Error(`Refusing to replace unexpected corpus directory ${resolvedCorpusDirectory}`);
  }

  const beforeDiagnostics = parseDiagnostics(beforeDiagnosticsPath);
  const afterDiagnostics = parseDiagnostics(afterDiagnosticsPath);
  const beforeRows = new Set(beforeDiagnostics.map((diagnostic) => diagnostic.diagnosticRow));
  const afterRows = new Set(afterDiagnostics.map((diagnostic) => diagnostic.diagnosticRow));
  if (beforeRows.size !== beforeDiagnostics.length || afterRows.size !== afterDiagnostics.length) {
    throw new Error("Dummy diagnostic reports contain duplicate rows");
  }
  const beforeByKey = new Map(
    beforeDiagnostics.map((diagnostic) => [diagnostic.diagnosticKey, diagnostic]),
  );
  const afterByKey = new Map(
    afterDiagnostics.map((diagnostic) => [diagnostic.diagnosticKey, diagnostic]),
  );

  const callsites = [
    ...[...beforeByKey.values()]
      .filter((diagnostic) => !afterByKey.has(diagnostic.diagnosticKey))
      .map((diagnostic) => ({ ...diagnostic, verdict: "pass" })),
    ...[...afterByKey.values()]
      .filter((diagnostic) => !beforeByKey.has(diagnostic.diagnosticKey))
      .map((diagnostic) => ({ ...diagnostic, verdict: "fail" })),
  ].sort((left, right) =>
    [left.project, left.filePath, left.reportedLine, left.reportedColumn, left.rule]
      .join(":")
      .localeCompare(
        [right.project, right.filePath, right.reportedLine, right.reportedColumn, right.rule].join(
          ":",
        ),
      ),
  );

  const fixtureGroups = new Map();
  for (const callsite of callsites) {
    const source = resolveSource(callsite);
    const sourceSha256 = sha256(source);
    const fixtureGroupKey = `${callsite.verdict}:${sourceSha256}`;
    const existingGroup = fixtureGroups.get(fixtureGroupKey);
    const group = existingGroup ?? {
      source,
      verdict: callsite.verdict,
      rules: new Set(),
      filePaths: [],
      callsites: [],
    };
    group.rules.add(callsite.rule);
    group.filePaths.push(callsite.filePath);
    group.callsites.push(callsite);
    fixtureGroups.set(fixtureGroupKey, group);
  }

  fs.rmSync(resolvedCorpusDirectory, { recursive: true, force: true });
  fs.mkdirSync(resolvedCorpusDirectory, { recursive: true });

  const fixtureByDiagnosticKey = new Map();
  const fixtures = [];
  for (const [fixtureGroupKey, group] of [...fixtureGroups].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const fixtureSourceSha256 = fixtureGroupKey.slice(fixtureGroupKey.indexOf(":") + 1);
    const extension = chooseExtension(group.filePaths);
    const firstCallsite = group.callsites[0];
    const sourceBaseName = toKebabCase(
      path.basename(firstCallsite.filePath, path.extname(firstCallsite.filePath)),
    );
    const directoryName = group.verdict === "pass" ? "regressions" : "true-positives";
    const fileName = `${fixtureSourceSha256.slice(0, HASH_PREFIX_LENGTH)}--${sourceBaseName}${extension}.txt`;
    const relativePath = path.posix.join(CORPUS_DIRECTORY_NAME, directoryName, fileName);
    const outputPath = path.join(resolvedCorpusDirectory, directoryName, fileName);
    const rules = [...group.rules].sort();
    const header = [
      `// rule: ${rules.join(", ")}`,
      `// file-path: ${firstCallsite.filePath}`,
      group.verdict === "fail" ? "// verdict: fail" : "// audit-verdict: pass",
      "// weakness: dummy-threejs-exact-callsite",
      `// source: Dummy 3D 207-project v9-to-v14 audit ${fixtureSourceSha256}`,
    ].join("\n");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${header}\n${group.source}`);
    fixtures.push({
      fixture: relativePath,
      verdict: group.verdict,
      rules,
      fixtureSourceSha256,
      filePath: firstCallsite.filePath,
    });
    for (const callsite of group.callsites) {
      fixtureByDiagnosticKey.set(callsite.diagnosticKey, relativePath);
    }
  }

  const manifestCallsites = callsites.map((callsite) => {
    const source = resolveSource(callsite);
    const sourceLine = source.split("\n")[callsite.reportedLine - 1];
    if (sourceLine === undefined) {
      throw new Error(
        `Missing reported source line ${callsite.project}:${callsite.filePath}:${callsite.reportedLine}`,
      );
    }
    const fixture = fixtureByDiagnosticKey.get(callsite.diagnosticKey);
    if (!fixture) throw new Error(`Missing fixture mapping for ${callsite.diagnosticKey}`);
    return {
      project: callsite.project,
      rule: callsite.rule,
      filePath: callsite.filePath,
      reportedLine: callsite.reportedLine,
      reportedColumn: callsite.reportedColumn,
      message: callsite.message,
      sourceSha256: sha256(source),
      sourceLineSha256: sha256(sourceLine),
      fixture,
      verdict: callsite.verdict,
    };
  });
  const auditedProjectIds = readAuditedProjects(selectedRootsPath);
  const manifest = {
    source: "Dummy 3D 207-project React Doctor v9-to-v14 exhaustive audit",
    sourceArtifacts: {
      beforeDiagnosticsSha256: sha256(fs.readFileSync(beforeDiagnosticsPath)),
      afterDiagnosticsSha256: sha256(fs.readFileSync(afterDiagnosticsPath)),
      selectedRootsSha256: sha256(fs.readFileSync(selectedRootsPath)),
    },
    expected: {
      auditedProjects: auditedProjectIds.length,
      totalCallsites: manifestCallsites.length,
      passCallsites: manifestCallsites.filter((callsite) => callsite.verdict === "pass").length,
      failCallsites: manifestCallsites.filter((callsite) => callsite.verdict === "fail").length,
      uniqueCallsiteFiles: new Set(
        manifestCallsites.map((callsite) => `${callsite.project}:${callsite.filePath}`),
      ).size,
      uniqueFixtures: fixtures.length,
    },
    auditedProjectIds,
    fixtures,
    callsites: manifestCallsites,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

main();
