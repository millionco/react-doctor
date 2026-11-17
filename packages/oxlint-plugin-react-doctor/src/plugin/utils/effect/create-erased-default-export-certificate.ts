import * as fs from "node:fs";
import { CROSS_FILE_PARSE_MAX_BYTES } from "../../constants/thresholds.js";
import type { SourceProjectModule } from "../build-source-project-index.js";
import { recordContentProbe } from "../cross-file-probe-recorder.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { getNodeStartIndex } from "../get-node-start-index.js";
import { getNodeEndIndex } from "../get-node-end-index.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { hasSupportedTypeOnlyDefaultExportEmission } from "./has-modern-source-scheduling-role.js";

export const createErasedDefaultExportCertificate = (
  module: SourceProjectModule,
  projectRoot?: string,
): ReadonlySet<EsTreeNode> => {
  const certifiedReferences = new Set<EsTreeNode>();
  if (!projectRoot || module.scopes.rootScope.node !== module.programNode)
    return certifiedReferences;
  const candidates: EsTreeNode[] = [];
  for (const statement of module.programNode.body) {
    if (
      !isNodeOfType(statement, "ExportDefaultDeclaration") ||
      statement.parent !== module.programNode ||
      !isNodeOfType(statement.declaration, "Identifier")
    )
      continue;
    const identifier = statement.declaration;
    const reference = module.scopes.referenceFor(identifier);
    if (
      !reference ||
      reference.flag !== "read" ||
      reference.scope !== module.scopes.rootScope ||
      reference.resolvedSymbol?.scope !== module.scopes.rootScope
    )
      continue;
    const declarations = module.scopes.rootScope.symbols.filter(
      (symbol) => symbol.name === identifier.name,
    );
    if (
      declarations.length > 0 &&
      declarations.every(
        (symbol) =>
          (symbol.kind === "ts-interface" || symbol.kind === "ts-type-alias") &&
          (isNodeOfType(symbol.declarationNode, "TSInterfaceDeclaration") ||
            isNodeOfType(symbol.declarationNode, "TSTypeAliasDeclaration")) &&
          !symbol.declarationNode.declare &&
          symbol.declarationNode.parent === module.programNode,
      )
    )
      candidates.push(identifier);
  }
  if (candidates.length === 0) return certifiedReferences;
  let sourceText: string;
  try {
    recordContentProbe(module.filePath);
    if (fs.statSync(module.filePath).size > CROSS_FILE_PARSE_MAX_BYTES) return certifiedReferences;
    sourceText = fs.readFileSync(module.filePath, "utf8");
  } catch {
    return certifiedReferences;
  }
  for (const identifier of candidates) {
    const statement = identifier.parent;
    if (
      !isNodeOfType(identifier, "Identifier") ||
      !isNodeOfType(statement, "ExportDefaultDeclaration") ||
      statement.declaration !== identifier
    )
      continue;
    const statementStart = getNodeStartIndex(statement);
    const statementEnd = getNodeEndIndex(statement);
    const identifierStart = getNodeStartIndex(identifier);
    const identifierEnd = getNodeEndIndex(identifier);
    if (
      ![statementStart, statementEnd, identifierStart, identifierEnd].every(Number.isSafeInteger) ||
      statementStart < 0 ||
      statementStart >= identifierStart ||
      identifierStart >= identifierEnd ||
      identifierEnd > statementEnd ||
      statementEnd > sourceText.length ||
      /[^\x00-\x7f]/.test(sourceText.slice(0, statementEnd)) ||
      sourceText.slice(identifierStart, identifierEnd) !== identifier.name ||
      !/^export[ \t\r\n]+default[ \t\r\n]+$/.test(
        sourceText.slice(statementStart, identifierStart),
      ) ||
      !/^[ \t\r\n]*;?[ \t\r\n]*$/.test(sourceText.slice(identifierEnd, statementEnd))
    )
      continue;
    certifiedReferences.add(identifier);
  }
  if (
    certifiedReferences.size > 0 &&
    !hasSupportedTypeOnlyDefaultExportEmission(module, projectRoot)
  )
    certifiedReferences.clear();
  return certifiedReferences;
};
