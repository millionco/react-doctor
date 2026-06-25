import ts from "typescript";
import type {
  DependencyGraph,
  DeslopConfig,
  SemanticConfidence,
  UnusedEnumMember,
} from "../types.js";
import type { SemanticContext } from "./program.js";
import type { ReferenceIndex } from "./references.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { buildSourceFileLookup, normalizeSourcePath } from "./utils/source-file-lookup.js";

interface EnumDeclarationContext {
  sourceFile: ts.SourceFile;
  declaration: ts.EnumDeclaration;
  modulePath: string;
}

const collectEnumDeclarations = (
  graph: DependencyGraph,
  config: DeslopConfig,
  sourceFileLookup: Map<string, ts.SourceFile>,
): EnumDeclarationContext[] => {
  const declarations: EnumDeclarationContext[] = [];

  const visitTopLevel = (sourceFile: ts.SourceFile, modulePath: string): void => {
    for (const statement of sourceFile.statements) {
      if (ts.isEnumDeclaration(statement)) {
        declarations.push({ sourceFile, declaration: statement, modulePath });
      }
    }
  };

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;

    const sourceFile = sourceFileLookup.get(normalizeSourcePath(module.fileId.path));
    if (!sourceFile) continue;
    visitTopLevel(sourceFile, module.fileId.path);
  }

  return declarations;
};

const isStringLiteralEnum = (declaration: ts.EnumDeclaration): boolean => {
  if (declaration.members.length === 0) return false;
  for (const member of declaration.members) {
    if (!member.initializer) return false;
    if (!ts.isStringLiteral(member.initializer)) return false;
  }
  return true;
};

const isConstEnum = (declaration: ts.EnumDeclaration): boolean => {
  const modifiers = ts.canHaveModifiers(declaration) ? ts.getModifiers(declaration) : undefined;
  if (!modifiers) return false;
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ConstKeyword);
};

const enumHasComputedAccess = (enumSymbol: ts.Symbol, referenceIndex: ReferenceIndex): boolean => {
  const references = referenceIndex.getReferences(enumSymbol);
  for (const referenceSite of references) {
    const parent = referenceSite.identifier.parent;
    if (!parent) continue;
    if (ts.isElementAccessExpression(parent) && parent.expression === referenceSite.identifier) {
      return true;
    }
  }
  return false;
};

const enumHasWholeObjectUse = (enumSymbol: ts.Symbol, referenceIndex: ReferenceIndex): boolean => {
  const references = referenceIndex.getReferences(enumSymbol);
  for (const referenceSite of references) {
    if (referenceSite.isDeclarationName) continue;
    if (referenceSite.isExportSpecifier) continue;
    if (referenceSite.isImportSpecifier) continue;
    const parent = referenceSite.identifier.parent;
    if (!parent) continue;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === referenceSite.identifier) {
      continue;
    }
    if (ts.isQualifiedName(parent) && parent.left === referenceSite.identifier) continue;
    if (ts.isElementAccessExpression(parent) && parent.expression === referenceSite.identifier) {
      continue;
    }
    if (ts.isTypeReferenceNode(parent)) continue;
    if (ts.isTypeQueryNode(parent)) continue;
    return true;
  }
  return false;
};

const memberHasExternalReference = (
  memberSymbol: ts.Symbol,
  referenceIndex: ReferenceIndex,
): boolean => {
  const references = referenceIndex.getReferences(memberSymbol);
  for (const referenceSite of references) {
    if (referenceSite.isDeclarationName) continue;
    return true;
  }
  return false;
};

const buildEnumMemberTrace = (
  enumName: string,
  memberName: string,
  declarationPath: string,
  line: number,
  column: number,
  hasComputedAccess: boolean,
  hasWholeObjectUse: boolean,
): string[] => {
  const trace = [
    `${declarationPath}:${line}:${column} declares ${enumName}.${memberName}`,
    `no static \`${enumName}.${memberName}\` reference found in the project`,
  ];
  if (hasComputedAccess) {
    trace.push(`${enumName}[...] computed access observed — confidence downgraded`);
  }
  if (hasWholeObjectUse) {
    trace.push(`${enumName} used as a whole value — confidence downgraded`);
  }
  return trace.slice(0, SEMANTIC_TRACE_MAX_ENTRIES);
};

export const detectUnusedEnumMembers = (
  graph: DependencyGraph,
  config: DeslopConfig,
  context: SemanticContext,
  referenceIndex: ReferenceIndex,
): UnusedEnumMember[] => {
  const findings: UnusedEnumMember[] = [];
  const sourceFileLookup = buildSourceFileLookup(context.program);
  const enumDeclarations = collectEnumDeclarations(graph, config, sourceFileLookup);
  if (enumDeclarations.length === 0) return findings;

  const { checker } = context;

  for (const { sourceFile, declaration, modulePath } of enumDeclarations) {
    const enumSymbol = checker.getSymbolAtLocation(declaration.name);
    if (!enumSymbol) continue;

    const hasComputedAccess = enumHasComputedAccess(enumSymbol, referenceIndex);
    const hasWholeObjectUse = enumHasWholeObjectUse(enumSymbol, referenceIndex);
    const isPureStringEnum = isStringLiteralEnum(declaration);
    const isConst = isConstEnum(declaration);

    if (hasWholeObjectUse) continue;
    if (hasComputedAccess) continue;

    let confidence: SemanticConfidence;
    if (isConst) {
      confidence = "low";
    } else if (isPureStringEnum) {
      confidence = "high";
    } else {
      confidence = "medium";
    }

    for (const member of declaration.members) {
      const memberSymbol = checker.getSymbolAtLocation(member.name);
      if (!memberSymbol) continue;
      if (memberHasExternalReference(memberSymbol, referenceIndex)) continue;

      const memberName = member.name.getText(sourceFile);
      const { line: zeroIndexedLine, character: zeroIndexedColumn } =
        sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
      const line = zeroIndexedLine + 1;
      const column = zeroIndexedColumn + 1;

      findings.push({
        path: modulePath,
        enumName: declaration.name.text,
        memberName,
        line,
        column,
        confidence,
        reason: `${declaration.name.text}.${memberName} is declared but never referenced`,
        trace: buildEnumMemberTrace(
          declaration.name.text,
          memberName,
          modulePath,
          line,
          column,
          false,
          false,
        ),
      });
    }
  }

  return findings;
};
