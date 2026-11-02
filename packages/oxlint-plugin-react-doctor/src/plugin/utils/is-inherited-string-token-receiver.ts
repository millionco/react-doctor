import * as path from "node:path";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { findSameFileTypeDeclarations } from "./find-same-file-type-declaration.js";
import { findVisibleSymbol } from "./find-visible-symbol.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasEnclosingTypeParameterNamed } from "./has-enclosing-type-parameter-named.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface StringTokenProgramFacts {
  readonly nodes: ReadonlyArray<EsTreeNode>;
  readonly stableIntrinsics: boolean;
}

const stringTokenProgramFacts = new WeakMap<EsTreeNode, StringTokenProgramFacts>();

const isStringTokenNonReferenceName = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) return parent.property === node && !parent.computed;
  if (isNodeOfType(parent, "Property"))
    return parent.key === node && !parent.computed && (!parent.shorthand || parent.value !== node);
  if (isNodeOfType(parent, "MethodDefinition") || isNodeOfType(parent, "PropertyDefinition"))
    return parent.key === node && !parent.computed;
  if (
    isNodeOfType(parent, "ImportSpecifier") ||
    isNodeOfType(parent, "ImportDefaultSpecifier") ||
    isNodeOfType(parent, "ImportNamespaceSpecifier")
  )
    return true;
  return (
    isNodeOfType(parent, "LabeledStatement") ||
    isNodeOfType(parent, "BreakStatement") ||
    isNodeOfType(parent, "ContinueStatement")
  );
};

const getStringTokenProgramFacts = (program: EsTreeNode): StringTokenProgramFacts => {
  const cached = stringTokenProgramFacts.get(program);
  if (cached) return cached;
  const nodes: EsTreeNode[] = [];
  let stableIntrinsics = true;
  walkAst(program, (node) => {
    nodes.push(node);
    if (
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSExportAssignment" ||
      node.type === "TSModuleDeclaration" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSParameterProperty" ||
      node.type === "WithStatement" ||
      node.type === "ImportExpression"
    )
      stableIntrinsics = false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      !isStringTokenNonReferenceName(node) &&
      ["String", "RegExp", "Symbol", "Object", "Reflect", "eval", "Function"].includes(node.name)
    )
      stableIntrinsics = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      if (
        name === null ||
        name === "constructor" ||
        name === "prototype" ||
        name === "__proto__" ||
        name === "__defineGetter__" ||
        name === "__defineSetter__" ||
        name === "eval" ||
        name === "Function" ||
        name === "String" ||
        name === "RegExp" ||
        name === "Symbol" ||
        name === "Object" ||
        name === "Reflect" ||
        name === "self" ||
        name === "globalThis" ||
        name === "window"
      )
        stableIntrinsics = false;
    }
    if (
      isNodeOfType(node, "ObjectPattern") &&
      node.properties.some(
        (property) =>
          !isNodeOfType(property, "Property") ||
          property.computed ||
          !isNodeOfType(property.key, "Identifier") ||
          (isNodeOfType(property.key, "Identifier") &&
            [
              "constructor",
              "prototype",
              "__proto__",
              "eval",
              "Function",
              "String",
              "RegExp",
              "Symbol",
              "Object",
              "Reflect",
            ].includes(property.key.name)),
      )
    )
      stableIntrinsics = false;
    if (
      isNodeOfType(node, "Identifier") &&
      ["globalThis", "window", "self"].includes(node.name) &&
      !isStringTokenNonReferenceName(node)
    ) {
      const parent = node.parent;
      if (
        !parent ||
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== node ||
        getStaticPropertyName(parent) === null
      )
        stableIntrinsics = false;
    }
  });
  const facts = { nodes, stableIntrinsics };
  stringTokenProgramFacts.set(program, facts);
  return facts;
};

const hasClosedStringTokenBinding = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  facts: StringTokenProgramFacts,
  onlyReference?: EsTreeNode,
): boolean => {
  let references = 0;
  for (const node of facts.nodes) {
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== symbol.name ||
      node === symbol.bindingIdentifier ||
      isTypeScriptTypePosition(node) ||
      isStringTokenNonReferenceName(node)
    )
      continue;
    const reference = scopes.referenceFor(node);
    if (
      !reference ||
      reference.resolvedSymbol !== symbol ||
      reference.flag !== "read" ||
      isWithinAssignmentTarget(node) ||
      (onlyReference && node !== onlyReference)
    )
      return false;
    references += 1;
  }
  return references > 0 && (!onlyReference || references === 1);
};

const isLiteralStringTokenSplitter = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") &&
  (typeof node.value === "string" ||
    ("regex" in node &&
      typeof node.regex === "object" &&
      node.regex !== null &&
      typeof node.regex.pattern === "string" &&
      typeof node.regex.flags === "string"));

const hasClosedStringTokenSplitter = (
  split: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  facts: StringTokenProgramFacts,
): boolean => {
  if (split.arguments.length === 0) return true;
  if (split.arguments.length !== 1) return false;
  const argument = stripParenExpression(split.arguments[0]);
  if (isLiteralStringTokenSplitter(argument)) return true;
  if (!isNodeOfType(argument, "Identifier")) return false;
  const symbol = findVisibleSymbol(argument, scopes);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    symbol.declarationNode.parent?.parent?.type === "ExportNamedDeclaration" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !symbol.initializer ||
    !isLiteralStringTokenSplitter(stripParenExpression(symbol.initializer)) ||
    symbol.declarationNode.range[1] > split.range[0]
  )
    return false;
  return hasClosedStringTokenBinding(symbol, scopes, facts, argument);
};

const findUniqueStringTokenInterface = (
  reference: EsTreeNode,
  name: string,
): EsTreeNodeOfType<"TSInterfaceDeclaration"> | null => {
  if (hasEnclosingTypeParameterNamed(reference, name)) return null;
  const program = findProgramRoot(reference);
  if (!program) return null;
  const declarations = findSameFileTypeDeclarations(reference, name);
  if (declarations.length !== 1) return null;
  const declaration = declarations[0];
  if (!isNodeOfType(declaration, "TSInterfaceDeclaration") || declaration.typeParameters)
    return null;
  let matches = 0;
  walkAst(program, (node) => {
    if (
      (isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "TSTypeAliasDeclaration") ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression")) &&
      node.id?.name === name
    )
      matches += 1;
  });
  return matches === 1 ? declaration : null;
};

const hasPlainStringTokenMembers = (
  declaration: EsTreeNodeOfType<"TSInterfaceDeclaration">,
): boolean =>
  declaration.body.body.every(
    (member) =>
      isNodeOfType(member, "TSPropertySignature") &&
      !member.computed &&
      isNodeOfType(member.key, "Identifier"),
  );

const declaresRequiredStringTokenProperty = (
  declaration: EsTreeNodeOfType<"TSInterfaceDeclaration">,
  propertyName: string,
): boolean => {
  if (declaration.extends.length !== 0 || !hasPlainStringTokenMembers(declaration)) return false;
  const members = declaration.body.body.filter(
    (member) =>
      isNodeOfType(member, "TSPropertySignature") &&
      isNodeOfType(member.key, "Identifier") &&
      member.key.name === propertyName,
  );
  if (members.length !== 1) return false;
  const member = members[0];
  return (
    isNodeOfType(member, "TSPropertySignature") &&
    !member.optional &&
    Boolean(
      member.typeAnnotation &&
      isNodeOfType(member.typeAnnotation.typeAnnotation, "TSStringKeyword"),
    )
  );
};

const inheritsRequiredStringTokenProperty = (
  annotation: EsTreeNode,
  propertyName: string,
  filename: string,
): boolean => {
  if (
    !isNodeOfType(annotation, "TSTypeReference") ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    annotation.typeArguments
  )
    return false;
  const child = findUniqueStringTokenInterface(annotation, annotation.typeName.name);
  if (
    !child ||
    child.extends.length !== 1 ||
    !hasPlainStringTokenMembers(child) ||
    child.body.body.some(
      (member) =>
        isNodeOfType(member, "TSPropertySignature") &&
        isNodeOfType(member.key, "Identifier") &&
        member.key.name === propertyName,
    )
  )
    return false;
  const base = child.extends[0];
  if (
    !isNodeOfType(base.expression, "Identifier") ||
    base.typeArguments ||
    hasEnclosingTypeParameterNamed(base, base.expression.name)
  )
    return false;
  const baseName = base.expression.name;
  const local = findUniqueStringTokenInterface(base, baseName);
  if (local) return declaresRequiredStringTokenProperty(local, propertyName);
  const program = findProgramRoot(child);
  if (!program || !isNodeOfType(program, "Program")) return false;
  let localCollision = false;
  walkAst(program, (node) => {
    if (
      (isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "TSTypeAliasDeclaration") ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression")) &&
      node.id?.name === baseName
    )
      localCollision = true;
  });
  if (localCollision) return false;
  const imports = program.body.flatMap((statement) =>
    isNodeOfType(statement, "ImportDeclaration")
      ? statement.specifiers
          .filter((specifier) => specifier.local.name === baseName)
          .map((specifier) => ({ statement, specifier }))
      : [],
  );
  if (imports.length !== 1) return false;
  const imported = imports[0];
  if (
    !isNodeOfType(imported.specifier, "ImportSpecifier") ||
    !isNodeOfType(imported.specifier.imported, "Identifier") ||
    typeof imported.statement.source.value !== "string"
  )
    return false;
  const resolved = resolveModulePath(filename, imported.statement.source.value);
  if (!resolved || resolved.split(path.sep).includes("node_modules")) return false;
  const provider = parseSourceFile(resolved);
  if (
    !provider ||
    !isNodeOfType(provider, "Program") ||
    !getStringTokenProgramFacts(provider).stableIntrinsics
  )
    return false;
  const declaration = findUniqueStringTokenInterface(provider, imported.specifier.imported.name);
  return Boolean(
    declaration &&
    declaration.parent &&
    isNodeOfType(declaration.parent, "ExportNamedDeclaration") &&
    declaration.parent.declaration === declaration &&
    declaresRequiredStringTokenProperty(declaration, propertyName),
  );
};

export const isInheritedStringTokenReceiver = (
  receiver: EsTreeNode,
  filename: string | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  try {
    if (!filename) return false;
    const split = stripParenExpression(receiver);
    if (
      !isNodeOfType(split, "CallExpression") ||
      !isNodeOfType(split.callee, "MemberExpression") ||
      getStaticPropertyName(split.callee) !== "split"
    )
      return false;
    const value = stripParenExpression(split.callee.object);
    if (!isNodeOfType(value, "Identifier")) return false;
    const symbol = findVisibleSymbol(value, scopes);
    const program = findProgramRoot(split);
    if (!symbol || symbol.kind !== "parameter" || !program) return false;
    const property = symbol.bindingIdentifier.parent;
    const pattern = property?.parent;
    if (
      !property ||
      !isNodeOfType(property, "Property") ||
      property.value !== symbol.bindingIdentifier ||
      property.computed ||
      !isNodeOfType(property.key, "Identifier") ||
      !pattern ||
      !isNodeOfType(pattern, "ObjectPattern") ||
      !pattern.typeAnnotation ||
      pattern.properties.some(
        (member) =>
          !isNodeOfType(member, "Property") ||
          member.computed ||
          !isNodeOfType(member.value, "Identifier"),
      )
    )
      return false;
    if (
      !isFunctionLike(pattern.parent) ||
      !pattern.parent.params.some((parameter) => parameter === pattern)
    )
      return false;
    const facts = getStringTokenProgramFacts(program);
    if (
      !facts.stableIntrinsics ||
      !hasClosedStringTokenBinding(symbol, scopes, facts) ||
      !hasClosedStringTokenSplitter(split, scopes, facts)
    )
      return false;
    return inheritsRequiredStringTokenProperty(
      pattern.typeAnnotation.typeAnnotation,
      property.key.name,
      filename,
    );
  } catch {
    return false;
  }
};
