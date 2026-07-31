#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { posix, resolve as resolveFileSystemPath } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const IMPACT_SCHEMA_VERSION = 1;
const EXPECTED_ARGUMENT_COUNT = 4;
const PLUGIN_SOURCE_ROOT = "packages/oxlint-plugin-react-doctor/src";
const RULES_ROOT = `${PLUGIN_SOURCE_ROOT}/plugin/rules/`;
const INCREMENTAL_RUNTIME_ROOTS = [
  RULES_ROOT,
  `${PLUGIN_SOURCE_ROOT}/plugin/constants/`,
  `${PLUGIN_SOURCE_ROOT}/plugin/utils/`,
];
const RUNTIME_SOURCE_PATTERN = /\.(?:[cm]?[jt]sx?|json)$/;
const TEST_SOURCE_PATTERN =
  /(?:^|\/)(?:__fixtures__|fixtures|tests?)\/|(?:\.|^)(?:test|spec)\.[cm]?[jt]sx?$|\.regressions\.test\.[cm]?[jt]sx?$|\/liveness\/liveness-fixtures\.ts$/;
const IGNORED_CHANGE_PATTERN = /^(?:\.changeset\/|docs?\/|packages\/fuzz\/)|\.(?:md|mdx|snap)$/;
const RULE_KEY_PREFIX = "react-doctor/";
const FINGERPRINT_VERSION = "react-doctor-parity-rule-fingerprint-v1";
const FULL_PARITY_RULE_KEYS = new Set(["react-doctor/react-compiler-no-manual-memoization"]);
const DIAGNOSTIC_INTERACTION_GROUPS = [
  [
    "react-doctor/no-initialize-state",
    "react-doctor/no-adjust-state-on-prop-change",
    "react-doctor/no-derived-state",
    "react-doctor/no-derived-state-effect",
  ],
  ["react-doctor/rules-of-hooks", "react-hooks-js/hooks"],
];

const usage = () =>
  "Usage: find-impacted-rules.mjs <repository-directory> <base-ref> <head-ref> <output-path>";

const runGit = (repositoryDirectory, argumentsToPass) =>
  execFileSync("git", ["-C", repositoryDirectory, ...argumentsToPass], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });

const resolveCommit = (repositoryDirectory, ref) =>
  runGit(repositoryDirectory, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();

const listSourcePaths = (repositoryDirectory, ref) =>
  runGit(repositoryDirectory, ["ls-tree", "-r", "-z", "--name-only", ref, "--", PLUGIN_SOURCE_ROOT])
    .split("\0")
    .filter(
      (sourcePath) =>
        sourcePath.length > 0 &&
        RUNTIME_SOURCE_PATTERN.test(sourcePath) &&
        !sourcePath.endsWith(".d.ts") &&
        !TEST_SOURCE_PATTERN.test(sourcePath),
    );

const readGitFile = (repositoryDirectory, ref, sourcePath) =>
  runGit(repositoryDirectory, ["show", `${ref}:${sourcePath}`]);

const loadSourceTree = (repositoryDirectory, ref) =>
  new Map(
    listSourcePaths(repositoryDirectory, ref).map((sourcePath) => [
      sourcePath,
      readGitFile(repositoryDirectory, ref, sourcePath),
    ]),
  );

const isRuntimeImport = (node) => {
  const importClause = node.importClause;
  if (!importClause) return true;
  if (importClause.isTypeOnly || importClause.name) return !importClause.isTypeOnly;
  const namedBindings = importClause.namedBindings;
  if (!namedBindings || ts.isNamespaceImport(namedBindings)) return true;
  return namedBindings.elements.some((specifier) => !specifier.isTypeOnly);
};

const isRuntimeExport = (node) => {
  if (node.isTypeOnly) return false;
  const exportClause = node.exportClause;
  if (!exportClause || !ts.isNamedExports(exportClause)) return true;
  return exportClause.elements.some((specifier) => !specifier.isTypeOnly);
};

const resolveRelativeModule = (sourcePath, moduleSpecifier, sourcePaths) => {
  const unresolvedPath = posix.normalize(posix.join(posix.dirname(sourcePath), moduleSpecifier));
  let extensionCandidates;
  if (unresolvedPath.endsWith(".js")) {
    extensionCandidates = [
      `${unresolvedPath.slice(0, -3)}.ts`,
      `${unresolvedPath.slice(0, -3)}.tsx`,
      unresolvedPath,
    ];
  } else if (unresolvedPath.endsWith(".jsx")) {
    extensionCandidates = [`${unresolvedPath.slice(0, -4)}.tsx`, unresolvedPath];
  } else if (unresolvedPath.endsWith(".mjs")) {
    extensionCandidates = [`${unresolvedPath.slice(0, -4)}.mts`, unresolvedPath];
  } else if (unresolvedPath.endsWith(".cjs")) {
    extensionCandidates = [`${unresolvedPath.slice(0, -4)}.cts`, unresolvedPath];
  } else if (RUNTIME_SOURCE_PATTERN.test(unresolvedPath)) {
    extensionCandidates = [unresolvedPath];
  } else {
    extensionCandidates = [
      `${unresolvedPath}.ts`,
      `${unresolvedPath}.tsx`,
      `${unresolvedPath}.mts`,
      `${unresolvedPath}.cts`,
      `${unresolvedPath}.js`,
      `${unresolvedPath}.jsx`,
      `${unresolvedPath}.mjs`,
      `${unresolvedPath}.cjs`,
      `${unresolvedPath}.json`,
      `${unresolvedPath}/index.ts`,
      `${unresolvedPath}/index.tsx`,
      `${unresolvedPath}/index.mts`,
      `${unresolvedPath}/index.cts`,
      `${unresolvedPath}/index.js`,
      `${unresolvedPath}/index.jsx`,
      `${unresolvedPath}/index.mjs`,
      `${unresolvedPath}/index.cjs`,
      `${unresolvedPath}/index.json`,
    ];
  }
  return extensionCandidates.find((candidatePath) => sourcePaths.has(candidatePath)) ?? null;
};

const collectModuleSpecifiers = (sourcePath, sourceContents) => {
  if (sourcePath.endsWith(".json")) return { moduleSpecifiers: [], uncertainty: null };
  const scriptKind = sourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceContents,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    return {
      moduleSpecifiers: [],
      uncertainty: `TypeScript could not parse ${sourcePath}`,
    };
  }
  const moduleSpecifiers = [];
  let uncertainty = null;
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      isRuntimeImport(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      moduleSpecifiers.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      const moduleExpression = statement.moduleReference.expression;
      if (moduleExpression && ts.isStringLiteralLike(moduleExpression)) {
        moduleSpecifiers.push(moduleExpression.text);
      } else {
        uncertainty = `Non-literal runtime module edge in ${sourcePath}`;
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      isRuntimeExport(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      moduleSpecifiers.push(statement.moduleSpecifier.text);
    }
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const [argument] = node.arguments;
        if (argument && ts.isStringLiteralLike(argument)) {
          moduleSpecifiers.push(argument.text);
        } else {
          uncertainty = `Non-literal runtime module edge in ${sourcePath}`;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return { moduleSpecifiers, uncertainty };
};

const extractRuleKey = (sourcePath, sourceContents) => {
  if (!sourcePath.startsWith(RULES_ROOT) || !sourcePath.endsWith(".ts")) return null;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceContents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let ruleKey = null;
  const visit = (node) => {
    if (
      ruleKey === null &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "defineRule" || node.expression.text === "defineRetiredRule")
    ) {
      const [definition] = node.arguments;
      if (definition && ts.isObjectLiteralExpression(definition)) {
        for (const property of definition.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ((ts.isIdentifier(property.name) && property.name.text === "id") ||
              (ts.isStringLiteral(property.name) && property.name.text === "id")) &&
            ts.isStringLiteralLike(property.initializer)
          ) {
            ruleKey = `${RULE_KEY_PREFIX}${property.initializer.text}`;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return ruleKey;
};

const buildModuleGraph = (sourceTree) => {
  const sourcePaths = new Set(sourceTree.keys());
  const dependencies = new Map();
  const ruleKeyBySourcePath = new Map();
  const sourcePathByRuleKey = new Map();
  const uncertainties = [];
  for (const [sourcePath, sourceContents] of sourceTree) {
    const { moduleSpecifiers, uncertainty } = collectModuleSpecifiers(sourcePath, sourceContents);
    if (uncertainty) uncertainties.push(uncertainty);
    const resolvedDependencies = new Set();
    for (const moduleSpecifier of moduleSpecifiers) {
      if (!moduleSpecifier.startsWith(".")) continue;
      const resolvedPath = resolveRelativeModule(sourcePath, moduleSpecifier, sourcePaths);
      if (resolvedPath === null) {
        uncertainties.push(`Unresolved runtime module ${moduleSpecifier} from ${sourcePath}`);
      } else {
        resolvedDependencies.add(resolvedPath);
      }
    }
    dependencies.set(sourcePath, resolvedDependencies);
    const ruleKey = extractRuleKey(sourcePath, sourceContents);
    if (ruleKey !== null) {
      const existingSourcePath = sourcePathByRuleKey.get(ruleKey);
      if (existingSourcePath) {
        uncertainties.push(`Duplicate rule key ${ruleKey}`);
      }
      ruleKeyBySourcePath.set(sourcePath, ruleKey);
      sourcePathByRuleKey.set(ruleKey, sourcePath);
    }
  }
  return {
    dependencies,
    reverseDependencies: buildReverseDependencies(dependencies),
    ruleKeyBySourcePath,
    sourceTree,
    uncertainties,
  };
};

const listChangedPaths = (repositoryDirectory, baseRef, headRef) => {
  const forwardPaths = runGit(repositoryDirectory, [
    "diff",
    "--name-only",
    "-z",
    baseRef,
    headRef,
  ]).split("\0");
  const reversePaths = runGit(repositoryDirectory, [
    "diff",
    "--name-only",
    "-z",
    headRef,
    baseRef,
  ]).split("\0");
  return [...new Set([...forwardPaths, ...reversePaths].filter(Boolean))].sort();
};

const buildReverseDependencies = (dependencies) => {
  const reverseDependencies = new Map();
  for (const [sourcePath, dependencyPaths] of dependencies) {
    for (const dependencyPath of dependencyPaths) {
      const importers = reverseDependencies.get(dependencyPath) ?? new Set();
      importers.add(sourcePath);
      reverseDependencies.set(dependencyPath, importers);
    }
  }
  return reverseDependencies;
};

const collectRuleImpact = (graph, changedPaths) => {
  const pendingPaths = changedPaths.filter((sourcePath) => graph.sourceTree.has(sourcePath));
  const visitedPaths = new Set();
  const impactedRules = new Set();
  const unscopedRuntimePaths = new Set();
  while (pendingPaths.length > 0) {
    const sourcePath = pendingPaths.pop();
    if (!sourcePath || visitedPaths.has(sourcePath)) continue;
    visitedPaths.add(sourcePath);
    const ruleKey = graph.ruleKeyBySourcePath.get(sourcePath);
    if (ruleKey) {
      impactedRules.add(ruleKey);
      continue;
    }
    if (!isIncrementalRuntimePath(sourcePath)) unscopedRuntimePaths.add(sourcePath);
    for (const importerPath of graph.reverseDependencies.get(sourcePath) ?? []) {
      pendingPaths.push(importerPath);
    }
  }
  return { impactedRules, unscopedRuntimePaths };
};

const buildRuleFingerprint = (graph, ruleSourcePath) => {
  const pendingPaths = [ruleSourcePath];
  const visitedPaths = new Set();
  while (pendingPaths.length > 0) {
    const sourcePath = pendingPaths.pop();
    if (!sourcePath || visitedPaths.has(sourcePath)) continue;
    visitedPaths.add(sourcePath);
    for (const dependencyPath of graph.dependencies.get(sourcePath) ?? []) {
      pendingPaths.push(dependencyPath);
    }
  }
  const hash = createHash("sha256").update(FINGERPRINT_VERSION).update("\0");
  for (const sourcePath of [...visitedPaths].sort()) {
    hash
      .update(sourcePath)
      .update("\0")
      .update(graph.sourceTree.get(sourcePath) ?? "")
      .update("\0");
  }
  return hash.digest("hex");
};

const isIgnoredChange = (sourcePath) =>
  IGNORED_CHANGE_PATTERN.test(sourcePath) || TEST_SOURCE_PATTERN.test(sourcePath);

const isIncrementalRuntimePath = (sourcePath) =>
  INCREMENTAL_RUNTIME_ROOTS.some((runtimeRoot) => sourcePath.startsWith(runtimeRoot));

const addDiagnosticInteractionClosure = (ruleKeys) => {
  const closedRuleKeys = new Set(ruleKeys);
  for (const interactionGroup of DIAGNOSTIC_INTERACTION_GROUPS) {
    if (interactionGroup.some((ruleKey) => closedRuleKeys.has(ruleKey))) {
      for (const ruleKey of interactionGroup) closedRuleKeys.add(ruleKey);
    }
  }
  return closedRuleKeys;
};

const isSecurityScanRule = (graph, ruleKey) => {
  for (const [sourcePath, sourceRuleKey] of graph.ruleKeyBySourcePath) {
    if (sourceRuleKey === ruleKey) return sourcePath.startsWith(`${RULES_ROOT}security-scan/`);
  }
  return false;
};

const buildManifest = (repositoryDirectory, baseRef, headRef) => {
  const baseCommit = resolveCommit(repositoryDirectory, baseRef);
  const headCommit = resolveCommit(repositoryDirectory, headRef);
  const changedPaths = listChangedPaths(repositoryDirectory, baseCommit, headCommit);
  const baseGraph = buildModuleGraph(loadSourceTree(repositoryDirectory, baseCommit));
  const headGraph = buildModuleGraph(loadSourceTree(repositoryDirectory, headCommit));
  const fallbackReasons = [...baseGraph.uncertainties, ...headGraph.uncertainties];
  const runtimeChangedPaths = changedPaths.filter((sourcePath) => !isIgnoredChange(sourcePath));
  for (const sourcePath of runtimeChangedPaths) {
    if (!sourcePath.startsWith(PLUGIN_SOURCE_ROOT) || !isIncrementalRuntimePath(sourcePath)) {
      fallbackReasons.push(`Global runtime change requires full parity: ${sourcePath}`);
    }
  }
  const baseImpact = collectRuleImpact(baseGraph, runtimeChangedPaths);
  const headImpact = collectRuleImpact(headGraph, runtimeChangedPaths);
  const directlyImpactedRuleKeys = new Set([
    ...baseImpact.impactedRules,
    ...headImpact.impactedRules,
  ]);
  for (const sourcePath of new Set([
    ...baseImpact.unscopedRuntimePaths,
    ...headImpact.unscopedRuntimePaths,
  ])) {
    fallbackReasons.push(`Plugin host dependency requires full parity: ${sourcePath}`);
  }
  if (runtimeChangedPaths.length === 0) {
    fallbackReasons.push("No runtime rule impact requires full parity");
  }
  const impactedRuleKeys = addDiagnosticInteractionClosure(directlyImpactedRuleKeys);
  for (const sourcePath of runtimeChangedPaths.filter(
    (path) => path.startsWith(PLUGIN_SOURCE_ROOT) && isIncrementalRuntimePath(path),
  )) {
    const mappedRuleKeys = new Set([
      ...collectRuleImpact(baseGraph, [sourcePath]).impactedRules,
      ...collectRuleImpact(headGraph, [sourcePath]).impactedRules,
    ]);
    if (mappedRuleKeys.size === 0) {
      fallbackReasons.push(`Changed plugin runtime cannot be mapped to a rule: ${sourcePath}`);
    }
  }
  for (const ruleKey of directlyImpactedRuleKeys) {
    if (isSecurityScanRule(baseGraph, ruleKey) || isSecurityScanRule(headGraph, ruleKey)) {
      fallbackReasons.push(`Security scan rule requires full parity: ${ruleKey}`);
    }
  }
  for (const ruleKey of impactedRuleKeys) {
    if (FULL_PARITY_RULE_KEYS.has(ruleKey)) {
      fallbackReasons.push(`Cross-rule suppression requires full parity: ${ruleKey}`);
    }
  }
  for (const sourcePath of runtimeChangedPaths.filter((path) =>
    path.startsWith(PLUGIN_SOURCE_ROOT),
  )) {
    if (!baseGraph.sourceTree.has(sourcePath) && !headGraph.sourceTree.has(sourcePath)) {
      fallbackReasons.push(`Changed runtime source is outside the graph: ${sourcePath}`);
    }
  }
  const allRuleKeys = new Set([
    ...baseGraph.ruleKeyBySourcePath.values(),
    ...headGraph.ruleKeyBySourcePath.values(),
  ]);
  const headRuleKeys = new Set(headGraph.ruleKeyBySourcePath.values());
  for (const ruleKey of directlyImpactedRuleKeys) {
    if (!headRuleKeys.has(ruleKey)) {
      fallbackReasons.push(`Removed or renamed rule requires full parity: ${ruleKey}`);
    }
  }
  const mode = fallbackReasons.length === 0 ? "incremental" : "full";
  const selectedRuleKeys = mode === "incremental" ? impactedRuleKeys : allRuleKeys;
  const ruleSourcePathByKey = new Map();
  for (const [sourcePath, ruleKey] of baseGraph.ruleKeyBySourcePath) {
    ruleSourcePathByKey.set(ruleKey, { base: sourcePath });
  }
  for (const [sourcePath, ruleKey] of headGraph.ruleKeyBySourcePath) {
    const existing = ruleSourcePathByKey.get(ruleKey) ?? {};
    ruleSourcePathByKey.set(ruleKey, { ...existing, head: sourcePath });
  }
  const rules = [...selectedRuleKeys].sort().map((ruleKey) => {
    const sourcePaths = ruleSourcePathByKey.get(ruleKey) ?? {};
    return {
      ruleKey,
      baseFingerprint: sourcePaths.base ? buildRuleFingerprint(baseGraph, sourcePaths.base) : null,
      headFingerprint: sourcePaths.head ? buildRuleFingerprint(headGraph, sourcePaths.head) : null,
    };
  });
  return {
    schemaVersion: IMPACT_SCHEMA_VERSION,
    mode,
    baseCommit,
    headCommit,
    changedPaths,
    runtimeChangedPaths,
    impactedRuleKeys: rules.map((rule) => rule.ruleKey),
    candidateRuleKeys:
      mode === "incremental"
        ? rules
            .map((rule) => rule.ruleKey)
            .filter((ruleKey) => !ruleKey.startsWith("react-doctor/") || headRuleKeys.has(ruleKey))
        : [],
    fallbackReasons: [...new Set(fallbackReasons)].sort(),
    rules,
  };
};

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolveFileSystemPath(process.argv[1]);

if (isMain) {
  const argumentsToParse = process.argv.slice(2);
  if (argumentsToParse.length !== EXPECTED_ARGUMENT_COUNT) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
  } else {
    const [repositoryDirectory, baseRef, headRef, outputPath] = argumentsToParse;
    try {
      const manifest = buildManifest(repositoryDirectory, baseRef, headRef);
      writeFileSync(outputPath, `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600 });
      process.stderr.write(
        `Rule impact: ${manifest.mode}, ${manifest.impactedRuleKeys.length} rule(s)\n`,
      );
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    }
  }
}
