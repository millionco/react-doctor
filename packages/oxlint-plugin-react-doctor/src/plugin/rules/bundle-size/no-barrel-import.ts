import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { createRelativeImportSource } from "../../utils/create-relative-import-source.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getBarrelIndexModuleInfo } from "../../utils/is-barrel-index-module.js";
import type { BarrelIndexModuleInfo } from "../../utils/is-barrel-index-module.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { resolveBarrelExportFilePath } from "../../utils/resolve-barrel-export-file-path.js";
import { resolveRelativeImportPath } from "../../utils/resolve-relative-import-path.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

interface RuntimeImportRequest {
  importedName: string | null;
  localName: string | null;
}

interface BarrelImportCandidate {
  node: EsTreeNodeOfType<"ImportDeclaration">;
  barrelFilePath: string;
  importRequests: RuntimeImportRequest[];
}

const TYPE_DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/;
const SERVER_ONLY_FILE_PATTERN = /\.server\.[cm]?[jt]sx?$/;

const getLiteralName = (node: { type: string; name?: string; value?: unknown }): string | null => {
  if (node.type === "Identifier" && typeof node.name === "string") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return null;
};

// Namespace specifiers (`import * as x`) are excluded: they deliberately
// take the whole barrel (window attachment, schema maps, combineReducers),
// so "import directly from the source file" is not actionable for them.
const getRuntimeImportRequests = (
  node: EsTreeNodeOfType<"ImportDeclaration">,
): RuntimeImportRequest[] => {
  if (node.importKind === "type") return [];

  return node.specifiers.flatMap((specifier) => {
    if (specifier.type === "ImportSpecifier") {
      if (specifier.importKind === "type") return [];
      return [
        {
          importedName: getLiteralName(specifier.imported),
          localName: getLiteralName(specifier.local),
        },
      ];
    }
    if (specifier.type === "ImportDefaultSpecifier") {
      return [{ importedName: "default", localName: getLiteralName(specifier.local) }];
    }
    return [];
  });
};

const getDistinctBarrelSources = (moduleInfo: BarrelIndexModuleInfo): Set<string> => {
  const distinctSources = new Set(moduleInfo.starExportSources);
  for (const target of moduleInfo.exportsByName.values()) distinctSources.add(target.source);
  return distinctSources;
};

// When the import names every runtime export of the barrel, direct imports
// would pull the exact same module graph — no code is saved.
const doesImportConsumeEveryRuntimeExport = (
  moduleInfo: BarrelIndexModuleInfo,
  importRequests: RuntimeImportRequest[],
): boolean => {
  if (moduleInfo.starExportSources.length > 0) return false;

  const importedNames = new Set(importRequests.map((request) => request.importedName));
  for (const target of moduleInfo.exportsByName.values()) {
    if (!target.isTypeOnly && !importedNames.has(target.exportedName)) return false;
  }
  return true;
};

const getJsxRootIdentifierName = (nameNode: EsTreeNode): string | null => {
  let currentNode = nameNode;
  while (isNodeOfType(currentNode, "JSXMemberExpression")) currentNode = currentNode.object;
  return isNodeOfType(currentNode, "JSXIdentifier") ? currentNode.name : null;
};

const isTypeOnlyOrReexportStatement = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ImportDeclaration")) return true;
  const statementKind = statement as { exportKind?: string; source?: unknown };
  if (statementKind.exportKind === "type") return true;
  return Boolean(statementKind.source);
};

// A module whose body is nothing but import and export statements is itself
// an aggregation barrel — typically the package's public entry point. Its
// imports exist only to be re-exported, so consumers pull the same module
// graph either way and direct-source imports would save nothing.
const isAggregationBarrelProgram = (programNode: EsTreeNodeOfType<"Program">): boolean => {
  let hasExportStatement = false;
  for (const statement of programNode.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) continue;
    if (isNodeOfType(statement, "ExportAllDeclaration")) {
      hasExportStatement = true;
      continue;
    }
    if (isNodeOfType(statement, "ExportNamedDeclaration") && !statement.declaration) {
      hasExportStatement = true;
      continue;
    }
    return false;
  }
  return hasExportStatement;
};

const collectValueReferenceNames = (programNode: EsTreeNodeOfType<"Program">): Set<string> => {
  const valueReferenceNames = new Set<string>();
  for (const statement of programNode.body) {
    if (isTypeOnlyOrReexportStatement(statement)) continue;
    collectReferenceIdentifierNames(statement, valueReferenceNames);
  }
  return valueReferenceNames;
};

const buildReportMessage = (
  filename: string,
  barrelFilePath: string,
  importRequests: RuntimeImportRequest[],
  isReactNativeTarget: boolean,
): string => {
  const costSentence = isReactNativeTarget
    ? "This ships extra code in your app bundle & slows startup."
    : "This ships extra code to your users & slows page load.";
  const directImportSources = new Set<string>();
  for (const request of importRequests) {
    if (!request.importedName) continue;

    const directFilePath = resolveBarrelExportFilePath(barrelFilePath, request.importedName);
    if (directFilePath)
      directImportSources.add(createRelativeImportSource(filename, directFilePath));
  }

  if (directImportSources.size === 1) {
    const [directImportSource] = directImportSources;
    return `${costSentence} Import directly from "${directImportSource}".`;
  }

  if (directImportSources.size > 1) {
    return `${costSentence} Import directly from: ${[...directImportSources].map((source) => `"${source}"`).join(", ")}.`;
  }

  return "Importing from an index file pulls in extra code. Import directly from the source file instead.";
};

// `test-noise` because stories / tests / playground / examples aren't
// shipped to users — barrel imports there don't expand the production
// bundle.
export const noBarrelImport = defineRule({
  id: "no-barrel-import",
  title: "Import from a barrel file",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Import from the direct path: `import { Button } from './components/Button'` instead of `./components`",
  create: (context: RuleContext): RuleVisitors => {
    const filename = normalizeFilename(context.filename ?? "");
    if (
      !filename ||
      TYPE_DECLARATION_FILE_PATTERN.test(filename) ||
      SERVER_ONLY_FILE_PATTERN.test(filename)
    ) {
      return {};
    }

    const candidates: BarrelImportCandidate[] = [];
    const jsxReferenceNames = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const source = node.source?.value;
        if (typeof source !== "string" || !source.startsWith(".")) return;

        const importRequests = getRuntimeImportRequests(node);
        if (importRequests.length === 0) return;

        const resolvedImportPath = resolveRelativeImportPath(filename, source);
        if (!resolvedImportPath) return;

        const moduleInfo = getBarrelIndexModuleInfo(resolvedImportPath);
        if (!moduleInfo.isBarrel) return;
        if (getDistinctBarrelSources(moduleInfo).size <= 1) return;
        if (doesImportConsumeEveryRuntimeExport(moduleInfo, importRequests)) return;

        candidates.push({ node, barrelFilePath: resolvedImportPath, importRequests });
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const rootIdentifierName = getJsxRootIdentifierName(node.name);
        if (rootIdentifierName) jsxReferenceNames.add(rootIdentifierName);
      },
      "Program:exit"(node: EsTreeNodeOfType<"Program">) {
        if (candidates.length === 0) return;
        if (isAggregationBarrelProgram(node)) return;

        const valueReferenceNames = collectValueReferenceNames(node);
        for (const candidate of candidates) {
          const hasRuntimeUsage = candidate.importRequests.some(
            (request) =>
              request.localName !== null &&
              (valueReferenceNames.has(request.localName) ||
                jsxReferenceNames.has(request.localName)),
          );
          if (!hasRuntimeUsage) continue;

          context.report({
            node: candidate.node,
            message: buildReportMessage(
              filename,
              candidate.barrelFilePath,
              candidate.importRequests,
              classifyReactNativeFileTarget(context) === "react-native",
            ),
          });
          return;
        }
      },
    };
  },
});
