import * as fs from "node:fs";
import * as path from "node:path";
import {
  IMPORTED_CLASS_PASSIVE_VALIDATOR_NAMES,
  IMPORTED_CLASS_REFUSED_MEMBER_NAMES,
  IMPORTED_CLASS_REFUSED_MODULE_SOURCES,
  IMPORTED_CLASS_REFUSED_GLOBAL_NAMES,
  IMPORTED_CLASS_CANONICAL_MODULE_SOURCES,
  IMPORTED_CLASS_PASSIVE_OBJECT_METHOD_NAMES,
  IMPORTED_CLASS_INSTANCE_MUTATION_NAMES,
} from "../constants/react.js";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { hasStandardReactJsxConfiguration } from "./resolve-tsconfig-alias.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { recordContentProbe } from "./cross-file-probe-recorder.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getImportedName } from "./get-imported-name.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { isReadonlyReactNamespaceJsxReference } from "./is-readonly-react-namespace-jsx-reference.js";
import { normalizeFilename } from "./normalize-filename.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import {
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
} from "./constants.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";

export interface ImportedPlainClassPropAnalyzer {
  (openingName: EsTreeNode, propName: string): boolean;
}

const isDirectSuperclass = (node: EsTreeNode): boolean =>
  (isNodeOfType(node.parent, "ClassDeclaration") || isNodeOfType(node.parent, "ClassExpression")) &&
  node.parent.superClass === node;

const hasCanonicalModuleConfiguration = (filename: string): boolean =>
  hasStandardReactJsxConfiguration(filename, { requireUnaliasedReact: true }) &&
  [...IMPORTED_CLASS_CANONICAL_MODULE_SOURCES].every(
    (source) =>
      !resolveWebpackAliasPath(filename, source)?.declared && !resolveModulePath(filename, source),
  );

const hasStandardModuleJsx = (module: SourceProjectModule, context: RuleContext): boolean => {
  let sourceText: string;
  try {
    const currentSource =
      module.programNode === context.scopes.rootScope.node
        ? context.sourceCode?.getText?.()
        : undefined;
    if (currentSource !== undefined) sourceText = currentSource;
    else {
      recordContentProbe(module.filePath);
      sourceText = fs.readFileSync(module.filePath, "utf8");
    }
  } catch {
    return false;
  }
  return !hasJsxRuntimePragma({
    program: module.programNode,
    filename: module.filePath,
    sourceText,
  });
};

const isBooleanOnlyConstructorRead = (member: EsTreeNode): boolean => {
  let current = findTransparentExpressionRoot(member);
  while (isNodeOfType(current.parent, "LogicalExpression")) {
    const logical = current.parent;
    if (logical.operator !== "&&" && logical.operator !== "||") return false;
    current = findTransparentExpressionRoot(logical);
  }
  const parent = current.parent;
  return Boolean(
    (isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "!" &&
      parent.argument === current) ||
    ((isNodeOfType(parent, "IfStatement") ||
      isNodeOfType(parent, "WhileStatement") ||
      isNodeOfType(parent, "DoWhileStatement") ||
      isNodeOfType(parent, "ForStatement") ||
      isNodeOfType(parent, "ConditionalExpression")) &&
      parent.test === current),
  );
};

const isPassiveObjectNamespaceUse = (reference: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(reference);
  const member = root.parent;
  if (!isNodeOfType(member, "MemberExpression") || member.object !== root || member.optional)
    return false;
  const name = getStaticPropertyKeyName(member);
  const call = findTransparentExpressionRoot(member).parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== findTransparentExpressionRoot(member) ||
    call.optional ||
    call.arguments.length !== 1 ||
    isNodeOfType(call.arguments[0], "SpreadElement")
  )
    return false;
  return Boolean(
    name &&
    (IMPORTED_CLASS_PASSIVE_OBJECT_METHOD_NAMES.has(name) ||
      (name === "create" &&
        isNodeOfType(call.arguments[0], "Literal") &&
        call.arguments[0].value === null)),
  );
};

const hasReadonlyPropTypesProvider = (module: SourceProjectModule): boolean =>
  module.scopes.rootScope.symbols.every((symbol) => {
    const declaration = getValueImportDeclaration(symbol);
    if (
      !isNodeOfType(declaration, "ImportDeclaration") ||
      declaration.source.value !== "prop-types"
    )
      return true;
    if (
      !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
      !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
    )
      return symbol.references.length === 0;
    if (
      !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) ||
      [...IMPORTED_CLASS_PASSIVE_VALIDATOR_NAMES].some((name) =>
        hasPossibleStaticPropertyMutationOrEscape(symbol.bindingIdentifier, name, module.scopes),
      )
    )
      return false;
    return symbol.references.every((reference) => {
      const identifier = reference.identifier;
      if (isNonReferenceIdentifier(identifier) || identifier === symbol.bindingIdentifier)
        return true;
      if (reference.flag !== "read" || isBindingAssignmentTarget(identifier)) return false;
      let current = findTransparentExpressionRoot(identifier);
      if (!isNodeOfType(current.parent, "MemberExpression") || current.parent.object !== current)
        return false;
      while (
        isNodeOfType(current.parent, "MemberExpression") &&
        current.parent.object === current
      ) {
        const member = current.parent;
        const name = getStaticPropertyName(member);
        if (
          !name ||
          IMPORTED_CLASS_REFUSED_MEMBER_NAMES.has(name) ||
          name === "default" ||
          isMemberMutationTarget(member)
        )
          return false;
        current = findTransparentExpressionRoot(member);
      }
      return true;
    });
  });

const hasReadonlyReactProviders = (module: SourceProjectModule): boolean =>
  module.scopes.rootScope.symbols.every((symbol) => {
    const declaration = getValueImportDeclaration(symbol);
    if (!isNodeOfType(declaration, "ImportDeclaration") || declaration.source.value !== "react")
      return true;
    const importedName = getImportedName(symbol.declarationNode);
    if (importedName === "Component" || importedName === "PureComponent") {
      return hasOnlyAllowedSymbolReads({
        symbol,
        program: module.programNode,
        scopes: module.scopes,
        allowedIdentifiers: new Set(
          symbol.references
            .filter((reference) => isDirectSuperclass(reference.identifier))
            .map((reference) => reference.identifier),
        ),
      });
    }
    if (
      !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
      !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
    )
      return true;
    if (
      !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) ||
      hasPossibleStaticPropertyMutationOrEscape(
        symbol.bindingIdentifier,
        "Component",
        module.scopes,
        (reference) => isReadonlyReactNamespaceJsxReference(reference, module.scopes),
      ) ||
      hasPossibleStaticPropertyMutationOrEscape(
        symbol.bindingIdentifier,
        "createElement",
        module.scopes,
        (reference) => isReadonlyReactNamespaceJsxReference(reference, module.scopes),
      )
    )
      return false;
    return symbol.references.every((reference) => {
      const identifier = reference.identifier;
      if (isNonReferenceIdentifier(identifier) || identifier === symbol.bindingIdentifier)
        return true;
      if (reference.flag !== "read" || isBindingAssignmentTarget(identifier)) return false;
      if (isReadonlyReactNamespaceJsxReference(identifier, module.scopes)) return true;
      const member = identifier.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== identifier ||
        isBindingAssignmentTarget(member)
      )
        return false;
      const propertyName = getStaticPropertyName(member);
      if (
        !propertyName ||
        IMPORTED_CLASS_REFUSED_MEMBER_NAMES.has(propertyName) ||
        propertyName === "default"
      )
        return false;
      return (
        (propertyName !== "Component" && propertyName !== "PureComponent") ||
        isDirectSuperclass(member)
      );
    });
  });

const hasClosedRuntimeSources = (
  module: SourceProjectModule,
  index: SourceProjectIndex,
): boolean => {
  let supported = true;
  walkAst(module.programNode, (node) => {
    for (const name of IMPORTED_CLASS_REFUSED_GLOBAL_NAMES) {
      if (isProvenGlobalNamespaceReference(node, name, module.scopes)) supported = false;
    }
    if (isProvenGlobalNamespaceReference(node, "require", module.scopes)) {
      const call = node.parent;
      const source = call && getGlobalRequireModuleSource(call, module.scopes);
      const resolvedPath = call && index.resolvedSourcePathByNode.get(call);
      if (
        !isNodeOfType(node, "Identifier") ||
        node.name !== "require" ||
        !module.scopes.isGlobalReference(node) ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== node ||
        call.optional ||
        call.arguments.length !== 1 ||
        !source?.startsWith(".") ||
        !resolvedPath ||
        !index.modulesByFilePath.has(resolvedPath)
      )
        supported = false;
    }
    const resolvedSource = index.resolvedSourcePathByNode.get(node);
    if (resolvedSource && !index.modulesByFilePath.has(resolvedSource)) supported = false;
    if (
      isProvenGlobalNamespaceReference(node, "Object", module.scopes) &&
      !isPassiveObjectNamespaceUse(node)
    )
      supported = false;
    const source = getRuntimeStaticDependencySource(node);
    if (source && IMPORTED_CLASS_REFUSED_MODULE_SOURCES.has(source)) supported = false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment")
    )
      supported = false;
    if (
      isNodeOfType(node, "Identifier") &&
      !isNonReferenceIdentifier(node) &&
      !module.scopes.symbolFor(node) &&
      (node.name === "eval" || node.name === "Function" || node.name === "Reflect")
    )
      supported = false;
    if (!isNodeOfType(node, "MemberExpression")) return;
    const propertyName = getStaticPropertyName(node);
    if (
      propertyName &&
      IMPORTED_CLASS_REFUSED_MEMBER_NAMES.has(propertyName) &&
      (propertyName !== "constructor" || !isBooleanOnlyConstructorRead(node))
    )
      supported = false;
    const writtenName = getResolvedStaticPropertyName(node, module.scopes);
    if (
      writtenName &&
      IMPORTED_CLASS_INSTANCE_MUTATION_NAMES.has(writtenName) &&
      isMemberMutationTarget(node)
    )
      supported = false;
    if (
      !propertyName &&
      (isProvenGlobalNamespaceReference(node.object, "Object", module.scopes) ||
        isProvenGlobalObjectReference(node.object, module.scopes))
    )
      supported = false;
  });
  return supported;
};

const getOwnPatternProperties = (pattern: EsTreeNode): ReadonlyArray<EsTreeNode> | null => {
  if (!isNodeOfType(pattern, "ObjectPattern") && !isNodeOfType(pattern, "ObjectExpression"))
    return null;
  const names = new Set<string>();
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
      return null;
    const name = getStaticPropertyKeyName(property);
    if (name === null || name === "__proto__" || names.has(name)) return null;
    names.add(name);
  }
  return pattern.properties;
};

const getNestedPropPattern = (pattern: EsTreeNode, propName: string): EsTreeNode | null => {
  const properties = getOwnPatternProperties(pattern);
  if (!properties) return null;
  const selected = properties.find((property) => getStaticPropertyKeyName(property) === propName);
  if (!selected || !isNodeOfType(selected, "Property")) return null;
  const value = selected.value;
  if (isNodeOfType(value, "ObjectPattern")) return getOwnPatternProperties(value) ? value : null;
  if (
    !isNodeOfType(value, "AssignmentPattern") ||
    !isNodeOfType(value.left, "ObjectPattern") ||
    !isNodeOfType(value.right, "ObjectExpression") ||
    value.right.properties.length !== 0
  )
    return null;
  return getOwnPatternProperties(value.left) ? value.left : null;
};

const getMemberOnlyRender = (classNode: EsTreeNode, propName: string): EsTreeNode | null => {
  if (
    !isNodeOfType(classNode, "ClassDeclaration") ||
    !classNode.id ||
    !isNodeOfType(classNode.superClass, "Identifier") ||
    classNode.decorators?.length
  )
    return null;
  if (classNode.body.body.length !== 1) return null;
  const method = classNode.body.body[0];
  if (
    !isNodeOfType(method, "MethodDefinition") ||
    method.static ||
    method.decorators?.length ||
    method.kind !== "method" ||
    getStaticPropertyKeyName(method) !== "render" ||
    !isNodeOfType(method.value, "FunctionExpression") ||
    method.value.async ||
    method.value.generator ||
    method.value.params.length !== 0 ||
    !isNodeOfType(method.value.body, "BlockStatement")
  )
    return null;
  let hasSelectedPattern = false;
  let supported = true;
  walkAst(method.value.body, (node) => {
    if (isNodeOfType(node, "Super") || isNodeOfType(node, "MetaProperty")) supported = false;
    if (!isNodeOfType(node, "ThisExpression")) return;
    const member = node.parent;
    const declarator = member?.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== node ||
      member.optional ||
      getStaticPropertyKeyName(member) !== "props" ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== member ||
      !isNodeOfType(declarator.parent, "VariableDeclaration") ||
      declarator.parent.kind !== "const" ||
      declarator.parent.parent !== method.value.body ||
      !getOwnPatternProperties(declarator.id)
    ) {
      supported = false;
      return;
    }
    const properties = getOwnPatternProperties(declarator.id);
    if (properties?.some((property) => getStaticPropertyKeyName(property) === propName)) {
      if (!getNestedPropPattern(declarator.id, propName)) supported = false;
      else hasSelectedPattern = true;
    }
  });
  return supported && hasSelectedPattern ? method.value : null;
};

const getPassivePropTypesReference = (
  identifier: EsTreeNode,
  module: SourceProjectModule,
): boolean => {
  const member = identifier.parent;
  const assignment = member?.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== identifier ||
    getStaticPropertyKeyName(member) !== "propTypes" ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== member ||
    !isNodeOfType(assignment.parent, "ExpressionStatement") ||
    assignment.parent.parent !== module.programNode ||
    !getOwnPatternProperties(assignment.right) ||
    !isNodeOfType(assignment.right, "ObjectExpression")
  )
    return false;
  const allowedBySymbol = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  for (const property of assignment.right.properties) {
    if (!isNodeOfType(property, "Property")) return false;
    let validator = property.value;
    if (
      isNodeOfType(validator, "MemberExpression") &&
      getStaticPropertyKeyName(validator) === "isRequired"
    )
      validator = validator.object;
    if (
      !isNodeOfType(validator, "MemberExpression") ||
      validator.optional ||
      !isNodeOfType(validator.object, "Identifier")
    )
      return false;
    const name = getStaticPropertyKeyName(validator);
    const symbol = module.scopes.symbolFor(validator.object);
    const declaration = symbol && getValueImportDeclaration(symbol);
    if (
      !name ||
      !IMPORTED_CLASS_PASSIVE_VALIDATOR_NAMES.has(name) ||
      !symbol ||
      !isNodeOfType(declaration, "ImportDeclaration") ||
      declaration.source.value !== "prop-types" ||
      !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
    )
      return false;
    const allowed = allowedBySymbol.get(symbol) ?? new Set();
    allowed.add(validator.object);
    allowedBySymbol.set(symbol, allowed);
  }
  return [...allowedBySymbol].every(([symbol, allowedIdentifiers]) =>
    hasOnlyAllowedSymbolReads({
      symbol,
      allowedIdentifiers,
      program: module.programNode,
      scopes: module.scopes,
    }),
  );
};

const hasClosedClassBinding = (classNode: EsTreeNode, module: SourceProjectModule): boolean => {
  if (
    !isNodeOfType(classNode, "ClassDeclaration") ||
    !classNode.id ||
    !isNodeOfType(classNode.superClass, "Identifier")
  )
    return false;
  const baseSymbol = module.scopes.symbolFor(classNode.superClass);
  const baseImport = baseSymbol && getValueImportDeclaration(baseSymbol);
  if (
    !baseSymbol ||
    getImportedName(baseSymbol.declarationNode) !== "Component" ||
    !isNodeOfType(baseImport, "ImportDeclaration") ||
    baseImport.source.value !== "react" ||
    !isNodeOfType(classNode.parent, "ExportDefaultDeclaration") ||
    classNode.parent.declaration !== classNode
  )
    return false;
  const symbol = module.scopes.symbolFor(classNode.id);
  if (!symbol) return false;
  const allowedIdentifiers = new Set(
    symbol.references
      .filter((reference) => getPassivePropTypesReference(reference.identifier, module))
      .map((reference) => reference.identifier),
  );
  return hasOnlyAllowedSymbolReads({
    symbol,
    allowedIdentifiers,
    program: module.programNode,
    scopes: module.scopes,
  });
};

const hasJsxOnlyImport = (symbol: SymbolDescriptor, module: SourceProjectModule): boolean => {
  if (!isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) return false;
  const allowedIdentifiers = new Set(
    symbol.references
      .filter((reference) => {
        const node = reference.identifier;
        return (
          isNodeOfType(node, "JSXIdentifier") &&
          (isNodeOfType(node.parent, "JSXOpeningElement") ||
            isNodeOfType(node.parent, "JSXClosingElement")) &&
          node.parent.name === node &&
          (!isNodeOfType(node.parent, "JSXOpeningElement") ||
            !node.parent.attributes.some(
              (attribute) =>
                isNodeOfType(attribute, "JSXSpreadAttribute") ||
                (isNodeOfType(attribute, "JSXAttribute") &&
                  isNodeOfType(attribute.name, "JSXIdentifier") &&
                  attribute.name.name === "ref"),
            ))
        );
      })
      .map((reference) => reference.identifier),
  );
  return hasOnlyAllowedSymbolReads({
    symbol,
    allowedIdentifiers,
    program: module.programNode,
    scopes: module.scopes,
  });
};

const hasClosedConsumers = (
  index: SourceProjectIndex,
  producer: SourceProjectModule,
  context: RuleContext,
): boolean => {
  if (
    index.hasOpaqueMdxConsumerSurface ||
    index.htmlFilePaths.length !== 0 ||
    [...index.unresolvedRuntimeSources].some(
      (source) => source.startsWith(".") || source.startsWith("/") || source.startsWith("#"),
    )
  )
    return false;
  for (const module of index.modulesByFilePath.values()) {
    if (
      !hasCanonicalModuleConfiguration(module.filePath) ||
      !hasStandardModuleJsx(module, context) ||
      !hasReadonlyReactProviders(module) ||
      !hasReadonlyPropTypesProvider(module) ||
      !hasClosedRuntimeSources(module, index)
    )
      return false;
  }
  for (const consumer of index.consumerModulesByFilePath.get(producer.filePath) ?? []) {
    let supported = true;
    walkAst(consumer.programNode, (node) => {
      if (index.resolvedSourcePathByNode.get(node) !== producer.filePath) return;
      if (!isNodeOfType(node, "ImportDeclaration") || node.specifiers.length !== 1) {
        supported = false;
        return;
      }
      const specifier = node.specifiers[0];
      const symbol =
        specifier &&
        isNodeOfType(specifier, "ImportDefaultSpecifier") &&
        consumer.scopes.symbolFor(specifier.local);
      if (!symbol || !hasJsxOnlyImport(symbol, consumer)) supported = false;
    });
    if (!supported) return false;
  }
  return true;
};

export const createImportedPlainClassPropAnalyzer = (
  context: RuleContext,
): ImportedPlainClassPropAnalyzer => {
  const filename = context.filename ? normalizeFilename(path.resolve(context.filename)) : null;
  let projectIndex: SourceProjectIndex | null | undefined;
  return (openingName, propName) => {
    if (!filename || !isNodeOfType(openingName, "JSXIdentifier")) return false;
    const symbol = context.scopes.symbolFor(openingName);
    const declaration = symbol && getValueImportDeclaration(symbol);
    if (
      !symbol ||
      !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
      !isNodeOfType(declaration, "ImportDeclaration") ||
      typeof declaration.source.value !== "string" ||
      !declaration.source.value.startsWith(".")
    )
      return false;
    const resolved = resolveCrossFileValueExportWithFilePath(
      filename,
      declaration.source.value,
      "default",
      { requireCompleteReexports: true },
    );
    if (
      !resolved ||
      resolved.contexts?.length !== 1 ||
      !getMemberOnlyRender(resolved.exportedNode, propName)
    )
      return false;
    const program = context.scopes.rootScope.node;
    if (!isNodeOfType(program, "Program")) return false;
    if (projectIndex === undefined) {
      const rootDirectory = findNearestPackageDirectory(filename);
      projectIndex = rootDirectory
        ? buildSourceProjectIndex({
            rootDirectory,
            currentFilePath: filename,
            currentProgramNode: program,
            currentScopes: context.scopes,
            sourceFileLimits: {
              maxEntryCount: SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
              maxFileCount: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
              maxFileSizeBytes: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
              maxTotalBytes: SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
            },
          })
        : null;
    }
    const producer = projectIndex?.modulesByFilePath.get(normalizeFilename(resolved.filePath));
    return Boolean(
      projectIndex &&
      projectIndex.modulesByFilePath.get(filename)?.programNode === program &&
      producer &&
      producer.programNode === resolved.programNode &&
      hasClosedClassBinding(resolved.exportedNode, producer) &&
      hasClosedConsumers(projectIndex, producer, context),
    );
  };
};
