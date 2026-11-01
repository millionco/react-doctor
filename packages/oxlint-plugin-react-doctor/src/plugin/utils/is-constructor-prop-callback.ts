import {
  CONSTRUCTOR_PROP_CALLBACK_ARGUMENT_COUNT,
  CONSTRUCTOR_PROP_CALLBACK_PARAMETER_COUNT,
  CONSTRUCTOR_PROP_CALLBACK_BINDING_COUNT,
  CONSTRUCTOR_PROP_CALLBACK_CLASS_NAMES,
  CONSTRUCTOR_PROP_CALLBACK_UNSUPPORTED_NAMES,
  CONSTRUCTOR_PROP_CALLBACK_RUNTIME_TYPESCRIPT_TYPES,
  REACT_PROVIDER_MUTATION_CAPABILITY_NAMES,
} from "../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDestructuredBindingPropertyName } from "./get-destructured-binding-property-name.js";
import { getImportedName } from "./get-imported-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isFunctionLike } from "./is-function-like.js";
import { readConstantBoolean } from "./read-constant-boolean.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isResultDiscardedCall } from "./is-result-discarded-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { resolveRuntimeValueBinding } from "./resolve-runtime-value-binding.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface ConstructorPropCallbackInput {
  readonly call: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly filename: string;
  readonly sourceText: string | null;
}

interface ConstructorProgramFacts {
  readonly supported: boolean;
  readonly readonlyBindings: WeakMap<SymbolDescriptor, boolean>;
  readonly classOrigins: WeakMap<EsTreeNode, boolean>;
  readonly propsBindings: WeakMap<SymbolDescriptor, boolean>;
  readonly constructorBodies: WeakMap<EsTreeNode, boolean>;
  superclassProviders?: ReadonlySet<SymbolDescriptor> | null;
}

const factsByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, ConstructorProgramFacts>>();

const getProgramFacts = (program: EsTreeNode, scopes: ScopeAnalysis): ConstructorProgramFacts => {
  let programs = factsByScopes.get(scopes);
  if (!programs) {
    programs = new WeakMap();
    factsByScopes.set(scopes, programs);
  }
  const cached = programs.get(program);
  if (cached) return cached;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      node.type === "NewExpression" ||
      node.type === "WithStatement" ||
      node.type === "ImportExpression" ||
      node.type === "Decorator" ||
      CONSTRUCTOR_PROP_CALLBACK_RUNTIME_TYPESCRIPT_TYPES.has(node.type)
    ) {
      supported = false;
      return false;
    }
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration")) &&
      node.source?.value === "react" &&
      node.exportKind !== "type"
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (node.source.value === "module" || node.source.value === "node:module") supported = false;
      return false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      !isNonReferenceIdentifier(node) &&
      CONSTRUCTOR_PROP_CALLBACK_UNSUPPORTED_NAMES.has(node.name)
    )
      supported = false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const name = getResolvedStaticPropertyName(node, scopes);
      if (
        (node.computed && name === null) ||
        name === "constructor" ||
        (name !== null && REACT_PROVIDER_MUTATION_CAPABILITY_NAMES.has(name))
      )
        supported = false;
    }
  });
  const facts = {
    supported,
    readonlyBindings: new WeakMap<SymbolDescriptor, boolean>(),
    classOrigins: new WeakMap<EsTreeNode, boolean>(),
    propsBindings: new WeakMap<SymbolDescriptor, boolean>(),
    constructorBodies: new WeakMap<EsTreeNode, boolean>(),
  };
  programs.set(program, facts);
  return facts;
};

const isReadonlyBinding = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  facts: ConstructorProgramFacts,
): boolean => {
  const cached = facts.readonlyBindings.get(symbol);
  if (cached !== undefined) return cached;
  const isReadonly =
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    );
  facts.readonlyBindings.set(symbol, isReadonly);
  return isReadonly;
};

const isSuperclassPosition = (expression: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(expression);
  return (
    (isNodeOfType(root.parent, "ClassDeclaration") ||
      isNodeOfType(root.parent, "ClassExpression")) &&
    root.parent.superClass === root
  );
};

const getGenuineReactSuperclassProviders = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  facts: ConstructorProgramFacts,
): ReadonlySet<SymbolDescriptor> | null => {
  if (facts.superclassProviders !== undefined) return facts.superclassProviders;
  facts.superclassProviders = null;
  const providers = new Set<SymbolDescriptor>();
  for (const symbol of scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (declaration?.source.value !== "react") continue;
    const specifier = symbol.declarationNode;
    if (
      declaration.importKind === "type" ||
      (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
    ) {
      if (symbol.references.length !== 0) return null;
      continue;
    }
    if (!isReadonlyBinding(symbol, program, scopes, facts)) return null;
    providers.add(symbol);
    const importedName = getImportedName(specifier);
    const isNamespace =
      isNodeOfType(specifier, "ImportDefaultSpecifier") ||
      isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
      importedName === "default";
    if (
      isNamespace &&
      [...CONSTRUCTOR_PROP_CALLBACK_CLASS_NAMES].some((name) =>
        hasPossibleStaticPropertyMutationOrEscape(symbol.bindingIdentifier, name, scopes),
      )
    )
      return null;
    if (
      !symbol.references.every((reference) => {
        const root = findTransparentExpressionRoot(reference.identifier);
        if (!isNamespace)
          return (
            importedName !== undefined &&
            CONSTRUCTOR_PROP_CALLBACK_CLASS_NAMES.has(importedName) &&
            isSuperclassPosition(root)
          );
        const member = root.parent;
        return (
          isNodeOfType(member, "MemberExpression") &&
          member.object === root &&
          !member.computed &&
          !member.optional &&
          isNodeOfType(member.property, "Identifier") &&
          CONSTRUCTOR_PROP_CALLBACK_CLASS_NAMES.has(member.property.name) &&
          isSuperclassPosition(member)
        );
      })
    )
      return null;
  }
  facts.superclassProviders = providers;
  return providers;
};

const hasGenuineReactSuperclass = (
  classNode: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  facts: ConstructorProgramFacts,
): boolean => {
  const cached = facts.classOrigins.get(classNode);
  if (cached !== undefined) return cached;
  facts.classOrigins.set(classNode, false);
  if (
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    !classNode.superClass
  )
    return false;
  if (
    !classNode.body.body.every(
      (member) =>
        isNodeOfType(member, "MethodDefinition") &&
        !member.computed &&
        !member.static &&
        (member.kind === "constructor" || member.kind === "method"),
    )
  )
    return false;
  const superclass = stripParenExpression(classNode.superClass);
  const identifier = isNodeOfType(superclass, "MemberExpression")
    ? stripParenExpression(superclass.object)
    : superclass;
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const selected = resolveRuntimeValueBinding(scopes.scopeFor(identifier), identifier.name);
  if (!selected || scopes.symbolFor(identifier) !== selected || selected.kind !== "import")
    return false;
  const providers = getGenuineReactSuperclassProviders(program, scopes, facts);
  const foundSelected = providers?.has(selected) ?? false;
  facts.classOrigins.set(classNode, foundSelected);
  return foundSelected;
};

const isDirectConstructorStatement = (
  call: EsTreeNode,
  body: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let node = findTransparentExpressionRoot(call);
  while (node.parent && node.parent !== body) {
    const parent = node.parent;
    if (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) {
      const truth = readConstantBoolean(parent.test, scopes);
      if (
        (truth === false && parent.consequent === node) ||
        (truth === true && parent.alternate === node)
      )
        return false;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      const truth = readConstantBoolean(parent.left, scopes);
      if (
        (parent.operator !== "&&" && parent.operator !== "||") ||
        (parent.operator === "&&" && truth === false) ||
        (parent.operator === "||" && truth === true)
      )
        return false;
    }
    if (
      !(
        (isNodeOfType(parent, "ExpressionStatement") && parent.expression === node) ||
        (isNodeOfType(parent, "BlockStatement") &&
          parent.body.some((statement) => statement === node)) ||
        (isNodeOfType(parent, "IfStatement") &&
          (parent.consequent === node || parent.alternate === node)) ||
        (isNodeOfType(parent, "UnaryExpression") &&
          parent.operator === "void" &&
          parent.argument === node) ||
        (isNodeOfType(parent, "LogicalExpression") && parent.right === node) ||
        (isNodeOfType(parent, "ConditionalExpression") &&
          (parent.consequent === node || parent.alternate === node)) ||
        (isNodeOfType(parent, "SequenceExpression") &&
          parent.expressions.some((expression) => expression === node))
      )
    )
      return false;
    node = findTransparentExpressionRoot(parent);
  }
  return node.parent === body;
};

export const isConstructorPropCallback = ({
  call,
  scopes,
  filename,
  sourceText,
}: ConstructorPropCallbackInput): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isResultDiscardedCall(call) ||
    sourceText === null ||
    !filename
  )
    return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const constructor = findEnclosingFunction(call);
  if (
    !isNodeOfType(constructor, "FunctionExpression") ||
    !isNodeOfType(constructor.parent, "MethodDefinition") ||
    constructor.parent.kind !== "constructor" ||
    constructor.parent.static ||
    constructor.parent.computed ||
    !isNodeOfType(constructor.parent.parent, "ClassBody") ||
    !isNodeOfType(constructor.body, "BlockStatement") ||
    !isDirectConstructorStatement(call, constructor.body, scopes) ||
    constructor.params.length !== CONSTRUCTOR_PROP_CALLBACK_PARAMETER_COUNT
  )
    return false;
  const [parameter] = constructor.params;
  const [firstStatement, bindingStatement] = constructor.body.body;
  if (
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(firstStatement, "ExpressionStatement") ||
    !isNodeOfType(firstStatement.expression, "CallExpression") ||
    firstStatement.expression.optional ||
    !isNodeOfType(firstStatement.expression.callee, "Super") ||
    firstStatement.expression.arguments.length !== CONSTRUCTOR_PROP_CALLBACK_ARGUMENT_COUNT
  )
    return false;
  const [superArgument] = firstStatement.expression.arguments;
  const parameterSymbol = scopes.symbolFor(parameter);
  if (
    !parameterSymbol ||
    parameterSymbol.kind !== "parameter" ||
    !isNodeOfType(superArgument, "Identifier") ||
    scopes.symbolFor(superArgument) !== parameterSymbol
  )
    return false;
  const callback = resolveRuntimeValueBinding(scopes.scopeFor(callee), callee.name);
  const declaration = callback?.declarationNode;
  if (
    !callback ||
    callback !== scopes.symbolFor(callee) ||
    callback.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !isNodeOfType(declaration.init, "Identifier") ||
    scopes.symbolFor(declaration.init) !== parameterSymbol ||
    declaration.range[1] > call.range[0] ||
    findEnclosingFunction(declaration) !== constructor
  )
    return false;
  if (
    !isNodeOfType(bindingStatement, "VariableDeclaration") ||
    bindingStatement.kind !== "const" ||
    bindingStatement.declarations.length !== CONSTRUCTOR_PROP_CALLBACK_BINDING_COUNT
  )
    return false;
  const [selectedBinding] = bindingStatement.declarations;
  if (
    selectedBinding !== declaration ||
    !declaration.id.properties.every(
      (candidate) =>
        isNodeOfType(candidate, "Property") &&
        !candidate.computed &&
        !candidate.method &&
        candidate.kind === "init" &&
        isNodeOfType(candidate.value, "Identifier"),
    )
  )
    return false;
  const property = callback.bindingIdentifier.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.parent !== declaration.id ||
    property.value !== callback.bindingIdentifier ||
    property.computed ||
    property.method ||
    property.kind !== "init" ||
    getDestructuredBindingPropertyName(callback.bindingIdentifier) === null
  )
    return false;
  const program = findProgramRoot(call);
  if (!program) return false;
  const facts = getProgramFacts(program, scopes);
  if (
    !facts.supported ||
    !isReadonlyBinding(parameterSymbol, program, scopes, facts) ||
    !isReadonlyBinding(callback, program, scopes, facts)
  )
    return false;
  let bodySupported = facts.constructorBodies.get(constructor);
  if (bodySupported === undefined) {
    bodySupported = true;
    walkAst(constructor.body, (child) => {
      if (isFunctionLike(child)) return false;
      if (child.type === "ReturnStatement" || child.type === "ThrowStatement")
        bodySupported = false;
    });
    facts.constructorBodies.set(constructor, bodySupported);
  }
  if (!bodySupported) return false;
  let propsSupported = facts.propsBindings.get(parameterSymbol);
  if (propsSupported === undefined) {
    propsSupported = parameterSymbol.references.every((reference) => {
      if (reference.identifier === superArgument) return true;
      const parent = reference.identifier.parent;
      return (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === reference.identifier &&
        isNodeOfType(parent.id, "ObjectPattern") &&
        isNodeOfType(parent.parent, "VariableDeclaration") &&
        parent.parent.kind === "const" &&
        findEnclosingFunction(parent) === constructor
      );
    });
    facts.propsBindings.set(parameterSymbol, propsSupported);
  }
  const classNode = constructor.parent.parent.parent;
  if (!isNodeOfType(classNode, "ClassDeclaration") || !classNode.id) return false;
  const classRoot =
    isNodeOfType(classNode.parent, "ExportNamedDeclaration") ||
    isNodeOfType(classNode.parent, "ExportDefaultDeclaration")
      ? classNode.parent
      : classNode;
  if (classRoot.parent !== program) return false;
  return (
    propsSupported &&
    !hasJsxRuntimePragma({ program, filename, sourceText }) &&
    hasGenuineReactSuperclass(classNode, program, scopes, facts) &&
    resolveModulePath(filename, "react") === null
  );
};
