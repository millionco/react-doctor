import { parseSync } from "oxc-parser";
import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findSameFileTypeDeclarations } from "../../../utils/find-same-file-type-declaration.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import {
  getReactDoctorStringArraySetting,
  getReactDoctorStringSetting,
} from "../../../utils/get-react-doctor-setting.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { hasEnclosingTypeParameterNamed } from "../../../utils/has-enclosing-type-parameter-named.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isReactHookCall } from "../../../utils/is-react-hook-call.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { someAst } from "../../../utils/some-ast.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  KEYED_RECORD_RESET_JSX_DIRECTIVE_PATTERN,
  KEYED_RECORD_RESET_PRIMITIVE_FIELD_TYPES,
  KEYED_RECORD_RESET_POSSIBLE_JSX_DIRECTIVE_PATTERN,
  KEYED_RECORD_RESET_UNSUPPORTED_GLOBAL_NAMES,
  KEYED_RECORD_RESET_UNSUPPORTED_MODULE_NAMES,
} from "./constants.js";

interface KeyedRecordPair {
  expression: EsTreeNodeOfType<"LogicalExpression">;
  record: SymbolDescriptor;
  firstProperty: string;
  fallbackProperty: string;
}

interface KeyedRecordCallerReferences {
  pair: KeyedRecordPair;
  members: Set<EsTreeNode>;
  props: Set<EsTreeNode>;
}

interface KeyedRecordProgramFacts {
  program: EsTreeNodeOfType<"Program">;
  hasOrdinaryProviders: boolean;
  typeNameCounts: ReadonlyMap<string, number>;
  rootSymbolCounts: ReadonlyMap<string, number>;
  runtimeComponentNameCounts: ReadonlyMap<string, number>;
  componentSymbols: ReadonlyMap<EsTreeNode, ReadonlyArray<SymbolDescriptor>>;
  reactElementFactories: ReadonlyMap<string, SymbolDescriptor>;
  runtimeBindingsByScope: WeakMap<ScopeDescriptor, ReadonlyMap<string, SymbolDescriptor | null>>;
  lastJsxFactory?: string;
  lastUsesClassicRuntime?: boolean;
  lastSourceText?: string;
  hasSupportedLastSource?: boolean;
}

const programFactsByScopes = new WeakMap<ScopeAnalysis, KeyedRecordProgramFacts>();

const getRecordPair = (node: EsTreeNode, context: RuleContext): KeyedRecordPair | null => {
  if (!isNodeOfType(node, "LogicalExpression") || node.operator !== "??") return null;
  const { left, right } = node;
  if (
    !isNodeOfType(left, "MemberExpression") ||
    !isNodeOfType(right, "MemberExpression") ||
    left.optional ||
    right.optional ||
    !isNodeOfType(left.object, "Identifier") ||
    !isNodeOfType(right.object, "Identifier")
  )
    return null;
  const record = context.scopes.symbolFor(left.object);
  const firstProperty = getStaticPropertyName(left);
  const fallbackProperty = getStaticPropertyName(right);
  if (
    !record ||
    record !== context.scopes.symbolFor(right.object) ||
    !firstProperty ||
    !fallbackProperty ||
    firstProperty === fallbackProperty
  )
    return null;
  return { expression: node, record, firstProperty, fallbackProperty };
};

const getParameterProperty = (symbol: SymbolDescriptor, owner: EsTreeNode): string | null => {
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  if (
    symbol.kind !== "parameter" ||
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.value !== symbol.bindingIdentifier ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    !isNodeOfType(symbol.bindingIdentifier, "Identifier") ||
    (!isNodeOfType(owner, "FunctionDeclaration") &&
      !isNodeOfType(owner, "ArrowFunctionExpression")) ||
    owner.params.length !== 1 ||
    owner.params[0] !== pattern
  )
    return null;
  const names = new Set<string>();
  for (const member of pattern.properties) {
    if (
      !isNodeOfType(member, "Property") ||
      member.computed ||
      !isNodeOfType(member.value, "Identifier")
    )
      return null;
    const name = getStaticKeyName(member.key);
    if (!name || names.has(name)) return null;
    names.add(name);
  }
  return getStaticKeyName(property.key);
};

const isStringField = (node: EsTreeNode | null | undefined, allowNullish: boolean): boolean => {
  if (isNodeOfType(node, "TSStringKeyword")) return true;
  if (!allowNullish || !isNodeOfType(node, "TSUnionType")) return false;
  return (
    node.types.some((member) => isNodeOfType(member, "TSStringKeyword")) &&
    node.types.every(
      (member) =>
        isNodeOfType(member, "TSStringKeyword") ||
        isNodeOfType(member, "TSNullKeyword") ||
        isNodeOfType(member, "TSUndefinedKeyword"),
    )
  );
};

const hasSelectedRecordInterface = (
  pair: KeyedRecordPair,
  facts: KeyedRecordProgramFacts,
): boolean => {
  const annotation = getSymbolTypeAnnotation(pair.record);
  if (
    !isNodeOfType(annotation, "TSTypeReference") ||
    annotation.typeArguments ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    hasEnclosingTypeParameterNamed(pair.record.bindingIdentifier, annotation.typeName.name)
  )
    return false;
  const typeName = annotation.typeName.name;
  const declarations = findSameFileTypeDeclarations(annotation, typeName);
  const declaration = declarations[0];
  if (
    declarations.length !== 1 ||
    !isNodeOfType(declaration, "TSInterfaceDeclaration") ||
    declaration.typeParameters ||
    declaration.extends.length > 0 ||
    declaration.declare
  )
    return false;
  if (
    findProgramRoot(annotation) !== facts.program ||
    facts.rootSymbolCounts.get(typeName) !== 1 ||
    facts.typeNameCounts.get(typeName) !== 1
  )
    return false;
  const names = new Set<string>();
  let didFindFirst = false;
  let didFindFallback = false;
  for (const member of declaration.body.body) {
    if (!isNodeOfType(member, "TSPropertySignature") || member.computed) return false;
    const name = getStaticKeyName(member.key);
    if (!name || names.has(name)) return false;
    names.add(name);
    if (name === pair.firstProperty) {
      if (!isStringField(member.typeAnnotation?.typeAnnotation, true)) return false;
      didFindFirst = true;
    }
    if (name === pair.fallbackProperty) {
      if (member.optional || !isStringField(member.typeAnnotation?.typeAnnotation, false))
        return false;
      didFindFallback = true;
    }
  }
  return didFindFirst && didFindFallback;
};

const isPlainModuleComponent = (component: EsTreeNode): boolean => {
  if (isNodeOfType(component, "FunctionDeclaration")) {
    return (
      isNodeOfType(component.parent, "Program") &&
      !component.async &&
      !component.generator &&
      !component.typeParameters &&
      !component.declare
    );
  }
  const declarator = component.parent;
  const declaration = declarator?.parent;
  return (
    isNodeOfType(component, "ArrowFunctionExpression") &&
    !component.async &&
    !component.typeParameters &&
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.init === component &&
    isNodeOfType(declarator.id, "Identifier") &&
    isNodeOfType(declaration, "VariableDeclaration") &&
    declaration.kind === "const" &&
    declaration.declarations.length === 1 &&
    isNodeOfType(declaration.parent, "Program")
  );
};

const isPrimitiveField = (annotation: EsTreeNode | null | undefined): boolean => {
  if (!annotation) return false;
  if (KEYED_RECORD_RESET_PRIMITIVE_FIELD_TYPES.has(annotation.type)) return true;
  if (isNodeOfType(annotation, "TSUnionType")) return annotation.types.every(isPrimitiveField);
  if (!isNodeOfType(annotation, "TSLiteralType")) return false;
  const literal = annotation.literal;
  if (isNodeOfType(literal, "Literal"))
    return (
      literal.value === null ||
      typeof literal.value === "string" ||
      typeof literal.value === "number" ||
      typeof literal.value === "boolean" ||
      typeof literal.value === "bigint"
    );
  return (
    isNodeOfType(literal, "UnaryExpression") &&
    literal.operator === "-" &&
    isNodeOfType(literal.argument, "Literal") &&
    (typeof literal.argument.value === "number" || typeof literal.argument.value === "bigint")
  );
};

const hasReadOnlyAliasReferences = (
  symbol: SymbolDescriptor,
  annotation: EsTreeNode | null | undefined,
  selectedInterface: EsTreeNode | null | undefined,
  fields: ReadonlyMap<string, EsTreeNode>,
  primitiveAnnotations: ReadonlySet<EsTreeNode>,
): boolean =>
  symbol.references.every((reference) => {
    const bindingProperty = symbol.bindingIdentifier.parent;
    if (
      isNodeOfType(bindingProperty, "Property") &&
      !bindingProperty.computed &&
      isNodeOfType(bindingProperty.parent, "ObjectPattern") &&
      bindingProperty.value === symbol.bindingIdentifier &&
      bindingProperty.key === reference.identifier
    )
      return true;
    if (reference.flag !== "read") return false;
    if (
      (annotation && primitiveAnnotations.has(annotation)) ||
      isTypeScriptTypePosition(reference.identifier)
    )
      return true;
    let memberAnnotation = annotation;
    let expression = findTransparentExpressionRoot(reference.identifier);
    while (
      isNodeOfType(expression.parent, "MemberExpression") &&
      expression.parent.object === expression
    ) {
      const name = getStaticPropertyName(expression.parent);
      if (!name) return false;
      const declarations =
        isNodeOfType(memberAnnotation, "TSTypeReference") &&
        !memberAnnotation.typeArguments &&
        isNodeOfType(memberAnnotation.typeName, "Identifier")
          ? findSameFileTypeDeclarations(memberAnnotation, memberAnnotation.typeName.name)
          : [];
      const field = fields.get(name);
      memberAnnotation =
        declarations.length === 1 &&
        declarations[0] === selectedInterface &&
        isNodeOfType(field, "TSPropertySignature")
          ? field.typeAnnotation?.typeAnnotation
          : null;
      expression = findTransparentExpressionRoot(expression.parent);
      if (memberAnnotation && primitiveAnnotations.has(memberAnnotation)) break;
    }
    const parent = expression.parent;
    if (
      memberAnnotation &&
      primitiveAnnotations.has(memberAnnotation) &&
      !isWithinAssignmentTarget(expression) &&
      !(isNodeOfType(parent, "CallExpression") && parent.callee === expression) &&
      !(isNodeOfType(parent, "NewExpression") && parent.callee === expression) &&
      !(isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === expression)
    )
      return true;
    return (
      (isNodeOfType(parent, "IfStatement") && parent.test === expression) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        parent.argument === expression &&
        (parent.operator === "void" || parent.operator === "typeof" || parent.operator === "!"))
    );
  });

const isReadOnlyDestructure = (
  identifier: EsTreeNode,
  pair: KeyedRecordPair,
  context: RuleContext,
): boolean => {
  const declarator = identifier.parent;
  const declaration = declarator?.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== identifier ||
    !isNodeOfType(declarator.id, "ObjectPattern") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1
  )
    return false;
  const annotation = getSymbolTypeAnnotation(pair.record);
  const selectedInterface =
    isNodeOfType(annotation, "TSTypeReference") && isNodeOfType(annotation.typeName, "Identifier")
      ? findSameFileTypeDeclarations(annotation, annotation.typeName.name)[0]
      : null;
  const fields = new Map<string, EsTreeNode>();
  const primitiveAnnotations = new Set<EsTreeNode>();
  if (isNodeOfType(selectedInterface, "TSInterfaceDeclaration")) {
    for (const member of selectedInterface.body.body) {
      if (!isNodeOfType(member, "TSPropertySignature") || member.computed) continue;
      const name = getStaticKeyName(member.key);
      if (name && !fields.has(name)) {
        fields.set(name, member);
        const fieldAnnotation = member.typeAnnotation?.typeAnnotation;
        if (fieldAnnotation && isPrimitiveField(fieldAnnotation))
          primitiveAnnotations.add(fieldAnnotation);
      }
    }
  }
  const names = new Set<string>();
  return declarator.id.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method ||
      !isNodeOfType(property.value, "Identifier")
    )
      return false;
    const name = getStaticKeyName(property.key);
    if (!name || names.has(name) || name === pair.firstProperty || name === pair.fallbackProperty)
      return false;
    names.add(name);
    const alias = context.scopes.symbolFor(property.value);
    const field = fields.get(name);
    return Boolean(
      alias &&
      hasReadOnlyAliasReferences(
        alias,
        isNodeOfType(field, "TSPropertySignature") ? field.typeAnnotation?.typeAnnotation : null,
        selectedInterface,
        fields,
        primitiveAnnotations,
      ),
    );
  });
};

const isNullGuardRead = (identifier: EsTreeNode): boolean => {
  const negation = identifier.parent;
  const statement = negation?.parent;
  if (
    !isNodeOfType(negation, "UnaryExpression") ||
    negation.operator !== "!" ||
    !isNodeOfType(statement, "IfStatement") ||
    statement.test !== negation ||
    statement.alternate
  )
    return false;
  const branch = statement.consequent;
  return (
    isNodeOfType(branch, "ReturnStatement") ||
    (isNodeOfType(branch, "BlockStatement") &&
      branch.body.length === 1 &&
      isNodeOfType(branch.body[0], "ReturnStatement"))
  );
};

const hasClosedRecordReferences = (
  pair: KeyedRecordPair,
  selectedMembers: ReadonlySet<EsTreeNode>,
  propExpressions: ReadonlySet<EsTreeNode>,
  context: RuleContext,
): boolean =>
  pair.record.references.length > 0 &&
  pair.record.references.every((reference) => {
    if (reference.flag !== "read") return false;
    const identifier = reference.identifier;
    const member = identifier.parent;
    if (isNodeOfType(member, "MemberExpression") && member.object === identifier)
      return selectedMembers.has(member);
    return (
      propExpressions.has(identifier) ||
      isNullGuardRead(identifier) ||
      isReadOnlyDestructure(identifier, pair, context)
    );
  });

const hasOrdinaryModuleProviders = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): boolean => {
  if (
    someAst(program, (node) => {
      if (isNodeOfType(node, "TSImportEqualsDeclaration") || isNodeOfType(node, "ImportExpression"))
        return true;
      if (
        isNodeOfType(node, "Identifier") &&
        !isTypeScriptTypePosition(node) &&
        KEYED_RECORD_RESET_UNSUPPORTED_GLOBAL_NAMES.has(node.name)
      )
        return true;
      if (isNodeOfType(node, "MemberExpression")) {
        const propertyName = getStaticPropertyName(node);
        return propertyName === "constructor" || (node.computed && propertyName === null);
      }
      if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
        return (
          getStaticPropertyKeyName(node, { allowComputedString: true }) === "constructor" ||
          node.computed
        );
      }
      return isNodeOfType(node, "Property") && node.kind !== "init";
    })
  )
    return false;
  let hasReactImport = false;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    const source = statement.source.value;
    if (source !== "react") {
      if (statement.importKind === "type") continue;
      if (KEYED_RECORD_RESET_UNSUPPORTED_MODULE_NAMES.has(source) || source.startsWith("preact"))
        return false;
      continue;
    }
    const runtimeSpecifiers: EsTreeNode[] = [];
    for (const specifier of statement.specifiers) {
      const isErased =
        statement.importKind === "type" ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type");
      if (!isErased) {
        runtimeSpecifiers.push(specifier);
        continue;
      }
      const symbol = context.scopes.symbolFor(specifier.local);
      if (
        !symbol ||
        symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
      )
        return false;
    }
    if (
      statement.importKind === "type" ||
      (statement.specifiers.length > 0 && runtimeSpecifiers.length === 0)
    )
      continue;
    hasReactImport = true;
    for (const specifier of runtimeSpecifiers) {
      if (!isNodeOfType(specifier, "ImportSpecifier")) return false;
      const symbol = context.scopes.symbolFor(specifier.local);
      if (
        !symbol ||
        symbol.references.some(
          (reference) =>
            reference.flag !== "read" ||
            !isNodeOfType(reference.identifier.parent, "CallExpression") ||
            reference.identifier.parent.callee !== reference.identifier,
        )
      )
        return false;
    }
  }
  return hasReactImport;
};

const getProgramFacts = (
  program: EsTreeNodeOfType<"Program">,
  context: RuleContext,
): KeyedRecordProgramFacts | null => {
  if (context.scopes.rootScope.node !== program) return null;
  const cached = programFactsByScopes.get(context.scopes);
  if (cached?.program === program) return cached;
  const typeNameCounts = new Map<string, number>();
  walkAst(program, (node) => {
    const identifier =
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration") ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression") ||
      isNodeOfType(node, "TSEnumDeclaration")
        ? node.id
        : isNodeOfType(node, "TSTypeParameter")
          ? node.name
          : null;
    if (isNodeOfType(identifier, "Identifier"))
      typeNameCounts.set(identifier.name, (typeNameCounts.get(identifier.name) ?? 0) + 1);
  });
  const rootSymbolCounts = new Map<string, number>();
  const runtimeComponentNameCounts = new Map<string, number>();
  const componentSymbols = new Map<EsTreeNode, SymbolDescriptor[]>();
  const reactElementFactories = new Map<string, SymbolDescriptor>();
  const runtimeBindingsByScope = new WeakMap<
    ScopeDescriptor,
    ReadonlyMap<string, SymbolDescriptor | null>
  >();
  const rootRuntimeBindings = new Map<string, SymbolDescriptor | null>();
  for (const symbol of context.scopes.rootScope.symbols) {
    if (!isErasedTypeScriptBinding(symbol))
      rootRuntimeBindings.set(symbol.name, rootRuntimeBindings.has(symbol.name) ? null : symbol);
    rootSymbolCounts.set(symbol.name, (rootSymbolCounts.get(symbol.name) ?? 0) + 1);
    if (symbol.kind !== "ts-interface" && symbol.kind !== "ts-type-alias")
      runtimeComponentNameCounts.set(
        symbol.name,
        (runtimeComponentNameCounts.get(symbol.name) ?? 0) + 1,
      );
    const matchingSymbols = componentSymbols.get(symbol.bindingIdentifier) ?? [];
    matchingSymbols.push(symbol);
    componentSymbols.set(symbol.bindingIdentifier, matchingSymbols);
    const declaration = symbol.declarationNode;
    if (
      isNodeOfType(declaration, "ImportSpecifier") &&
      declaration.importKind !== "type" &&
      isNodeOfType(declaration.parent, "ImportDeclaration") &&
      declaration.parent.importKind !== "type" &&
      declaration.parent.source.value === "react" &&
      getStaticKeyName(declaration.imported) === "createElement"
    )
      reactElementFactories.set(symbol.name, symbol);
  }
  runtimeBindingsByScope.set(context.scopes.rootScope, rootRuntimeBindings);
  const facts: KeyedRecordProgramFacts = {
    program,
    hasOrdinaryProviders: hasOrdinaryModuleProviders(program, context),
    typeNameCounts,
    rootSymbolCounts,
    runtimeComponentNameCounts,
    componentSymbols,
    reactElementFactories,
    runtimeBindingsByScope,
  };
  programFactsByScopes.set(context.scopes, facts);
  return facts;
};

const hasSupportedJsxSource = (sourceText: string, facts: KeyedRecordProgramFacts): boolean => {
  if (facts.lastSourceText === sourceText) return facts.hasSupportedLastSource === true;
  facts.lastSourceText = sourceText;
  facts.hasSupportedLastSource = false;
  facts.lastJsxFactory = undefined;
  facts.lastUsesClassicRuntime = false;
  if (!KEYED_RECORD_RESET_POSSIBLE_JSX_DIRECTIVE_PATTERN.test(sourceText)) {
    facts.hasSupportedLastSource = true;
    return true;
  }
  try {
    const parsed = parseSync("keyed-record-reset.tsx", sourceText, { astType: "ts", lang: "tsx" });
    if (parsed.errors.some((error) => error.severity === "Error")) return false;
    for (const comment of parsed.comments) {
      for (const directive of comment.value.matchAll(KEYED_RECORD_RESET_JSX_DIRECTIVE_PATTERN)) {
        const [, kind, provider] = directive;
        if (
          (kind === "jsxImportSource" && provider !== "react") ||
          (kind === "jsx" && (!provider || !facts.reactElementFactories.has(provider)))
        )
          return false;
        if (kind === "jsx") {
          if (facts.lastJsxFactory && facts.lastJsxFactory !== provider) return false;
          facts.lastJsxFactory = provider;
        }
        if (kind === "jsxRuntime" && provider === "classic") facts.lastUsesClassicRuntime = true;
      }
    }
    facts.hasSupportedLastSource = true;
    return true;
  } catch {
    return false;
  }
};

const hasSelectedReactJsxFactory = (
  call: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  facts: KeyedRecordProgramFacts,
): boolean => {
  const factoryName = facts.lastJsxFactory ?? (facts.lastUsesClassicRuntime ? "React" : undefined);
  if (!factoryName) return true;
  const expectedFactory = facts.lastJsxFactory
    ? facts.reactElementFactories.get(factoryName)
    : undefined;
  if (facts.lastJsxFactory && !expectedFactory) return false;
  let scope: ScopeDescriptor | null = context.scopes.scopeFor(call);
  while (scope) {
    let bindings = facts.runtimeBindingsByScope.get(scope);
    if (!bindings) {
      const runtimeBindings = new Map<string, SymbolDescriptor | null>();
      for (const symbol of scope.symbols) {
        if (!isErasedTypeScriptBinding(symbol))
          runtimeBindings.set(symbol.name, runtimeBindings.has(symbol.name) ? null : symbol);
      }
      bindings = runtimeBindings;
      facts.runtimeBindingsByScope.set(scope, bindings);
    }
    const actualFactory = bindings.get(factoryName);
    if (actualFactory !== undefined)
      return Boolean(expectedFactory && actualFactory === expectedFactory);
    scope = scope.parent;
  }
  return !facts.lastJsxFactory;
};

const getAttributeExpression = (attribute: EsTreeNode | null): EsTreeNode | null => {
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
  )
    return null;
  return attribute.value.expression;
};

const getComponentCalls = (
  component: EsTreeNode,
  context: RuleContext,
  facts: KeyedRecordProgramFacts,
): EsTreeNodeOfType<"JSXOpeningElement">[] | null => {
  const bindingIdentifier = getFunctionBindingIdentifier(component);
  const symbols = bindingIdentifier ? (facts.componentSymbols.get(bindingIdentifier) ?? []) : [];
  const symbol = symbols[0];
  if (
    symbols.length !== 1 ||
    !symbol ||
    symbol.scope.kind !== "module" ||
    facts.runtimeComponentNameCounts.get(symbol.name) !== 1
  )
    return null;
  const calls: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
  for (const reference of symbol.references) {
    const tag = reference.identifier.parent;
    if (reference.flag !== "read" || !isNodeOfType(reference.identifier, "JSXIdentifier"))
      return null;
    if (isNodeOfType(tag, "JSXOpeningElement") && tag.name === reference.identifier) {
      if (findEnclosingFunction(tag) === component) return null;
      calls.push(tag);
    } else if (
      isNodeOfType(tag, "JSXClosingElement") &&
      tag.name === reference.identifier &&
      isNodeOfType(tag.parent, "JSXElement") &&
      tag.parent.closingElement === tag &&
      isNodeOfType(tag.parent.openingElement.name, "JSXIdentifier") &&
      context.scopes.symbolFor(tag.parent.openingElement.name) === symbol
    )
      continue;
    else return null;
  }
  return calls.length > 0 ? calls : null;
};

export const hasKeyedImmutableRecordReset = (
  component: EsTreeNode,
  effect: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const program = findProgramRoot(component);
  if (
    !program ||
    !isPlainModuleComponent(component) ||
    findEnclosingFunction(effect) !== component ||
    !isReactApiCall(effect, "useEffect", context.scopes)
  )
    return false;
  const capabilities = getReactDoctorStringArraySetting(context.settings, "capabilities");
  if (
    (capabilities.includes("preact") && !capabilities.includes("react")) ||
    getReactDoctorStringSetting(context.settings, "preactVersion")
  )
    return false;
  const sourceCode = context.sourceCode;
  if (!sourceCode?.getText) return false;
  let sourceText: string;
  try {
    sourceText = sourceCode.getText();
  } catch {
    return false;
  }
  if (typeof sourceText !== "string") return false;
  const facts = getProgramFacts(program, context);
  if (!facts?.hasOrdinaryProviders || !hasSupportedJsxSource(sourceText, facts)) return false;
  if (
    someAst(
      component,
      (node) =>
        isReactHookCall(node, "useState", context.scopes) &&
        !isReactApiCall(node, "useState", context.scopes),
    )
  )
    return false;
  const dependencies = effect.arguments[1];
  if (!isNodeOfType(dependencies, "ArrayExpression") || dependencies.elements.length !== 1)
    return false;
  const dependency = dependencies.elements[0];
  if (!dependency) return false;
  let expression: EsTreeNode = dependency;
  if (isNodeOfType(dependency, "Identifier")) {
    const alias = context.scopes.symbolFor(dependency);
    const initializer = alias && getDirectConstInitializer(alias);
    const declaration = alias?.declarationNode.parent;
    if (
      !alias ||
      !initializer ||
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.declarations.length !== 1 ||
      declaration.parent !== effect.parent?.parent ||
      alias.references.some(
        (reference) => reference.flag !== "read" || reference.identifier !== dependency,
      ) ||
      initializer.range[0] >= effect.range[0]
    )
      return false;
    expression = initializer;
  }
  const pair = getRecordPair(expression, context);
  if (
    !pair ||
    !getParameterProperty(pair.record, component) ||
    !hasSelectedRecordInterface(pair, facts)
  )
    return false;
  const propName = getParameterProperty(pair.record, component);
  if (!propName || propName === "key" || propName === "ref") return false;
  const calls = getComponentCalls(component, context, facts);
  if (!calls || !calls.every((call) => hasSelectedReactJsxFactory(call, context, facts)))
    return false;
  if (
    !hasClosedRecordReferences(
      pair,
      new Set([pair.expression.left, pair.expression.right]),
      new Set(),
      context,
    )
  )
    return false;
  const callers = new Map<SymbolDescriptor, KeyedRecordCallerReferences>();
  for (const call of calls) {
    const names = new Set<string>();
    for (const attribute of call.attributes) {
      if (!isNodeOfType(attribute, "JSXAttribute")) return false;
      const name = getJsxAttributeName(attribute.name);
      if (!name || names.has(name)) return false;
      names.add(name);
      if (
        name === "key" ||
        name === propName ||
        !attribute.value ||
        isNodeOfType(attribute.value, "Literal")
      )
        continue;
      const value = getAttributeExpression(attribute);
      if (!value || (!isNodeOfType(value, "Identifier") && !isNodeOfType(value, "Literal")))
        return false;
    }
    const key = getAttributeExpression(getAuthoritativeJsxAttribute(call.attributes, "key"));
    const prop = getAttributeExpression(getAuthoritativeJsxAttribute(call.attributes, propName));
    const caller = findEnclosingFunction(call);
    const callerPair = key && getRecordPair(key, context);
    if (
      !caller ||
      !callerPair ||
      !isNodeOfType(prop, "Identifier") ||
      !getParameterProperty(callerPair.record, caller) ||
      context.scopes.symbolFor(prop) !== callerPair.record ||
      callerPair.firstProperty !== pair.firstProperty ||
      callerPair.fallbackProperty !== pair.fallbackProperty
    )
      return false;
    const collected = callers.get(callerPair.record) ?? {
      pair: callerPair,
      members: new Set<EsTreeNode>(),
      props: new Set<EsTreeNode>(),
    };
    collected.members.add(callerPair.expression.left);
    collected.members.add(callerPair.expression.right);
    collected.props.add(prop);
    callers.set(callerPair.record, collected);
  }
  return [...callers.values()].every((caller) =>
    hasClosedRecordReferences(caller.pair, caller.members, caller.props, context),
  );
};
