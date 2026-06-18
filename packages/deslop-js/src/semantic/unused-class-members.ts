import ts from "typescript";
import type {
  ClassMemberKind,
  DependencyGraph,
  DeslopConfig,
  SemanticConfidence,
  UnusedClassMember,
} from "../types.js";
import type { SemanticContext } from "./program.js";
import type { ReferenceIndex } from "./references.js";
import { SEMANTIC_TRACE_MAX_ENTRIES } from "../constants.js";
import { buildSourceFileLookup, normalizeSourcePath } from "./utils/source-file-lookup.js";
import { isFrameworkLifecycleMethod } from "../utils/is-framework-lifecycle-method.js";

interface ClassContext {
  sourceFile: ts.SourceFile;
  declaration: ts.ClassDeclaration;
  modulePath: string;
  isExported: boolean;
}

const isClassExported = (declaration: ts.ClassDeclaration): boolean => {
  const modifiers = ts.canHaveModifiers(declaration) ? ts.getModifiers(declaration) : undefined;
  if (!modifiers) return false;
  return modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.ExportKeyword ||
      modifier.kind === ts.SyntaxKind.DefaultKeyword,
  );
};

const collectClassDeclarations = (
  graph: DependencyGraph,
  config: DeslopConfig,
  sourceFileLookup: Map<string, ts.SourceFile>,
): ClassContext[] => {
  const contexts: ClassContext[] = [];

  for (const module of graph.modules) {
    if (!module.isReachable) continue;
    if (module.isDeclarationFile) continue;
    if (module.isEntryPoint && !config.includeEntryExports) continue;

    const sourceFile = sourceFileLookup.get(normalizeSourcePath(module.fileId.path));
    if (!sourceFile) continue;

    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      if (!statement.name) continue;
      contexts.push({
        sourceFile,
        declaration: statement,
        modulePath: module.fileId.path,
        isExported: isClassExported(statement),
      });
    }
  }

  return contexts;
};

interface SubclassMemberIndex {
  getOverridingMemberNames: (parentClassSymbol: ts.Symbol) => Set<string>;
}

const buildSubclassMemberIndex = (
  classContexts: ClassContext[],
  checker: ts.TypeChecker,
): SubclassMemberIndex => {
  const parentToOverriddenMemberNames = new Map<ts.Symbol, Set<string>>();

  const addOverrideNames = (parentSymbol: ts.Symbol, memberNames: string[]): void => {
    const existing = parentToOverriddenMemberNames.get(parentSymbol);
    if (existing) {
      for (const memberName of memberNames) existing.add(memberName);
    } else {
      parentToOverriddenMemberNames.set(parentSymbol, new Set(memberNames));
    }
  };

  const collectMemberNames = (declaration: ts.ClassDeclaration): string[] => {
    const names: string[] = [];
    for (const member of declaration.members) {
      if (!member.name || !ts.isIdentifier(member.name)) continue;
      names.push(member.name.text);
    }
    return names;
  };

  for (const { declaration } of classContexts) {
    if (!declaration.heritageClauses) continue;
    for (const heritageClause of declaration.heritageClauses) {
      if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const heritageType of heritageClause.types) {
        const baseSymbol = checker.getSymbolAtLocation(heritageType.expression);
        if (!baseSymbol) continue;
        const resolvedBaseSymbol =
          baseSymbol.flags & ts.SymbolFlags.Alias
            ? safeGetAliasedSymbol(baseSymbol, checker)
            : baseSymbol;
        if (!resolvedBaseSymbol) continue;
        addOverrideNames(resolvedBaseSymbol, collectMemberNames(declaration));
      }
    }
  }

  return {
    getOverridingMemberNames: (parentClassSymbol) =>
      parentToOverriddenMemberNames.get(parentClassSymbol) ?? new Set(),
  };
};

const safeGetAliasedSymbol = (
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Symbol | undefined => {
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return undefined;
  }
};

const isPrivateMember = (member: ts.ClassElement): boolean => {
  if (ts.isPrivateIdentifier(member.name as ts.Node)) return true;
  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
  if (!modifiers) return false;
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword);
};

const isStaticMember = (member: ts.ClassElement): boolean => {
  const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
  if (!modifiers) return false;
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
};

const hasAllowedDecorator = (member: ts.ClassElement, decoratorAllowlist: Set<string>): boolean => {
  const decorators = ts.canHaveDecorators(member) ? ts.getDecorators(member) : undefined;
  if (!decorators || decorators.length === 0) return false;
  for (const decorator of decorators) {
    const expression = decorator.expression;
    let decoratorName: string | undefined;
    if (ts.isIdentifier(expression)) {
      decoratorName = expression.text;
    } else if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
      decoratorName = expression.expression.text;
    } else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
      decoratorName = expression.name.text;
    }
    if (decoratorName && decoratorAllowlist.has(decoratorName)) return true;
  }
  return false;
};

const classifyMemberKind = (member: ts.ClassElement): ClassMemberKind | undefined => {
  if (ts.isMethodDeclaration(member)) return "method";
  if (ts.isPropertyDeclaration(member)) return "property";
  if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) return "accessor";
  return undefined;
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

const buildClassMemberTrace = (
  className: string,
  memberName: string,
  modulePath: string,
  line: number,
  column: number,
  isOverriddenInSubclass: boolean,
  isExportedClass: boolean,
): string[] => {
  const trace: string[] = [
    `${modulePath}:${line}:${column} declares ${className}.${memberName}`,
    `no \`${className}.${memberName}\` reference found outside the declaration`,
  ];
  if (isExportedClass) {
    trace.push(`${className} is exported — confidence reduced for public-API safety`);
  }
  if (isOverriddenInSubclass) {
    trace.push(`subclass override observed — polymorphic call path possible`);
  }
  return trace.slice(0, SEMANTIC_TRACE_MAX_ENTRIES);
};

export const detectUnusedClassMembers = (
  graph: DependencyGraph,
  config: DeslopConfig,
  context: SemanticContext,
  referenceIndex: ReferenceIndex,
  decoratorAllowlist: string[],
): UnusedClassMember[] => {
  const findings: UnusedClassMember[] = [];
  const sourceFileLookup = buildSourceFileLookup(context.program);
  const classContexts = collectClassDeclarations(graph, config, sourceFileLookup);
  if (classContexts.length === 0) return findings;

  const { checker } = context;
  const decoratorAllowSet = new Set(decoratorAllowlist);
  const subclassMemberIndex = buildSubclassMemberIndex(classContexts, checker);

  for (const { sourceFile, declaration, modulePath, isExported } of classContexts) {
    const classSymbol = checker.getSymbolAtLocation(declaration.name!);
    if (!classSymbol) continue;

    const overriddenMemberNames = subclassMemberIndex.getOverridingMemberNames(classSymbol);

    for (const member of declaration.members) {
      if (ts.isConstructorDeclaration(member)) continue;
      if (!member.name) continue;
      const memberKind = classifyMemberKind(member);
      if (!memberKind) continue;
      if (isPrivateMember(member)) continue;
      if (hasAllowedDecorator(member, decoratorAllowSet)) continue;

      const memberSymbol = checker.getSymbolAtLocation(member.name);
      if (!memberSymbol) continue;
      if (memberHasExternalReference(memberSymbol, referenceIndex)) continue;

      const memberName = ts.isIdentifier(member.name)
        ? member.name.text
        : member.name.getText(sourceFile);
      const isOverriddenInSubclass = overriddenMemberNames.has(memberName);
      if (isOverriddenInSubclass) continue;
      if (isFrameworkLifecycleMethod(memberName)) continue;

      const { line: zeroIndexedLine, character: zeroIndexedColumn } =
        sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile));
      const line = zeroIndexedLine + 1;
      const column = zeroIndexedColumn + 1;

      const confidence: SemanticConfidence = isExported ? "low" : "high";

      findings.push({
        path: modulePath,
        className: declaration.name!.text,
        memberName,
        memberKind,
        isStatic: isStaticMember(member),
        line,
        column,
        confidence,
        reason: isExported
          ? `${declaration.name!.text}.${memberName} has no internal references; flagged at low confidence because ${declaration.name!.text} is part of the public API surface`
          : `${declaration.name!.text}.${memberName} is declared but never referenced`,
        trace: buildClassMemberTrace(
          declaration.name!.text,
          memberName,
          modulePath,
          line,
          column,
          false,
          isExported,
        ),
      });
    }
  }

  return findings;
};
