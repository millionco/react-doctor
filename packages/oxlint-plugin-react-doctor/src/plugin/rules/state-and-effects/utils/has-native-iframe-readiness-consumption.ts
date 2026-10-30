import { readFileSync } from "node:fs";
import { HTML_TAGS, VOID_DOM_ELEMENTS } from "../../../constants/html-tags.js";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findSameFileTypeDeclarations } from "../../../utils/find-same-file-type-declaration.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasEnclosingTypeParameterNamed } from "../../../utils/has-enclosing-type-parameter-named.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { readNearestPackageManifest } from "../../../utils/read-nearest-package-manifest.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { collectUseStateBindings } from "./collect-use-state-bindings.js";
import {
  READINESS_CAPABILITY_NAMES,
  READINESS_MEMBER_CAPABILITIES,
  READINESS_RUNTIME_TYPESCRIPT,
  READINESS_NATIVE_IFRAME_ATTRIBUTES,
  READINESS_INACTIVE_IFRAME_CONTAINERS,
  READINESS_PROTOCOL_ARGUMENT_COUNT,
  READINESS_SINGLE_VALUE_COUNT,
  READINESS_SOURCE_GUARD_STATEMENT_COUNT,
  READINESS_MESSAGE_LISTENER_ARGUMENT_COUNT,
  READINESS_SEND_AND_CONSUME_STATEMENT_COUNT,
} from "./constants.js";

interface ReadinessContext {
  readonly filename?: string;
  readonly scopes: ScopeAnalysis;
  readonly sourceCode?: { getText?: (node?: EsTreeNode | null) => string };
  readonly sourceText?: string;
}

interface ReadinessModule {
  readonly filename: string;
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly snapshotPayload?: EsTreeNode;
}

interface ReadinessReferenceProofs {
  readonly program: EsTreeNode;
  readonly reactCalls: WeakMap<SymbolDescriptor, boolean>;
}

const referenceProofsByScopes = new WeakMap<ScopeAnalysis, ReadinessReferenceProofs>();
const immediateModuleScopes = new WeakMap<EsTreeNode, ScopeAnalysis>();

const getReferenceProofs = (module: ReadinessModule): ReadinessReferenceProofs => {
  let proofs = referenceProofsByScopes.get(module.scopes);
  if (proofs?.program !== module.program) {
    proofs = { program: module.program, reactCalls: new WeakMap() };
    referenceProofsByScopes.set(module.scopes, proofs);
  }
  return proofs;
};

interface ReadinessClosedProgramProof {
  readonly program: EsTreeNode;
  readonly closed: boolean;
  readonly topLevelCalls: readonly EsTreeNode[];
}

const closedProgramsByScopes = new WeakMap<ScopeAnalysis, ReadinessClosedProgramProof>();

interface ReadinessBridge {
  readonly send: SymbolDescriptor;
  readonly attach: SymbolDescriptor;
}

const sameBinding = (
  node: EsTreeNode | null | undefined,
  binding: SymbolDescriptor,
  module: ReadinessModule,
): boolean => isNodeOfType(node, "Identifier") && module.scopes.symbolFor(node) === binding;

const hasOnlyReferences = (
  binding: SymbolDescriptor,
  module: ReadinessModule,
  accepts: (node: EsTreeNode) => boolean,
): boolean => {
  return (
    hasCompleteSymbolReferences(binding, module.program, module.scopes) &&
    binding.references.every(
      (reference) =>
        isNonReferenceIdentifier(reference.identifier) ||
        isTypeScriptTypePosition(reference.identifier) ||
        (reference.flag === "read" &&
          !isWithinAssignmentTarget(reference.identifier) &&
          accepts(reference.identifier)),
    )
  );
};

const memberName = (node: EsTreeNode | null | undefined): string | null =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier")
    ? node.property.name
    : null;

const callOf = (node: EsTreeNode | null | undefined): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!node) return null;
  const candidate = stripParenExpression(node);
  return isNodeOfType(candidate, "CallExpression") &&
    !candidate.optional &&
    candidate.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
    ? candidate
    : null;
};

const expressionOf = (statement: EsTreeNode | null | undefined): EsTreeNode | null =>
  isNodeOfType(statement, "ExpressionStatement")
    ? stripParenExpression(statement.expression)
    : null;

const isLiteral = (
  node: EsTreeNode | null | undefined,
  value: string | boolean | number | null,
): boolean => isNodeOfType(node, "Literal") && node.value === value;

const isDependency = (node: EsTreeNode, module: ReadinessModule): boolean => {
  const root = findTransparentExpressionRoot(node);
  const list = root.parent;
  const call = list?.parent;
  return (
    isNodeOfType(list, "ArrayExpression") &&
    list.elements.some((element) => element === root) &&
    isNodeOfType(call, "CallExpression") &&
    call.arguments[1] === list &&
    (isReactCall(call, "useEffect", module) || isReactCall(call, "useCallback", module))
  );
};

const directImport = (
  node: EsTreeNode,
  module: ReadinessModule,
  source: string,
  name: string,
  allowType = false,
): SymbolDescriptor | null => {
  let binding = module.scopes.symbolFor(node);
  if (allowType && isNodeOfType(node, "Identifier")) {
    if (hasEnclosingTypeParameterNamed(node, node.name)) return null;
    let scope: ScopeAnalysis["rootScope"] | null = module.scopes.scopeFor(node);
    while (scope) {
      const matches = scope.symbols.filter((candidate) => candidate.name === node.name);
      if (matches.length) {
        binding = matches.length === READINESS_SINGLE_VALUE_COUNT ? matches[0] : null;
        break;
      }
      scope = scope.parent;
    }
  }
  const declaration = binding && getImportDeclarationForSymbol(binding);
  const specifier = binding?.declarationNode;
  return binding &&
    declaration?.source.value === source &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    (allowType || (declaration.importKind !== "type" && specifier.importKind !== "type")) &&
    getImportedName(specifier) === name &&
    !resolveModulePath(module.filename, source)
    ? binding
    : null;
};

const isReactCall = (node: EsTreeNode, name: string, module: ReadinessModule): boolean => {
  const call = callOf(node);
  if (!call || !isNodeOfType(call.callee, "Identifier")) return false;
  const binding = directImport(call.callee, module, "react", name);
  if (!binding) return false;
  const proofs = getReferenceProofs(module);
  let reactCalls = proofs.reactCalls.get(binding);
  if (reactCalls === undefined) {
    reactCalls = hasOnlyReferences(binding, module, (reference) => {
      const root = findTransparentExpressionRoot(reference);
      return callOf(root.parent)?.callee === root;
    });
    proofs.reactCalls.set(binding, reactCalls);
  }
  return reactCalls;
};

const getClosedProgramProof = (module: ReadinessModule): ReadinessClosedProgramProof => {
  const cached = closedProgramsByScopes.get(module.scopes);
  if (cached?.program === module.program) return cached;
  let closed = true;
  const topLevelCalls: EsTreeNode[] = [];
  walkAst(module.program, (node) => {
    if (!closed) return false;
    if (
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    )
      return false;
    if (
      READINESS_RUNTIME_TYPESCRIPT.has(node.type) ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "NewExpression")
    )
      closed = false;
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (node.importKind === "type") return false;
      if (
        node.source.value === "module" ||
        node.source.value === "node:module" ||
        node.source.value === "preact" ||
        node.source.value === "react/jsx-runtime" ||
        node.source.value === "react/jsx-dev-runtime"
      )
        closed = false;
      if (node.source.value === "@sanity/ui")
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            continue;
          const binding = module.scopes.symbolFor(specifier.local);
          if (
            !isNodeOfType(specifier, "ImportSpecifier") ||
            getImportedName(specifier) === "default"
          ) {
            if (
              !binding ||
              binding.references.some(
                (reference) => !isTypeScriptTypePosition(reference.identifier),
              )
            )
              closed = false;
          } else if (
            getImportedName(specifier) === "Card" &&
            (!binding ||
              !hasOnlyReferences(
                binding,
                module,
                (reference) =>
                  isNodeOfType(reference.parent, "JSXOpeningElement") ||
                  isNodeOfType(reference.parent, "JSXClosingElement"),
              ))
          )
            closed = false;
        }
      if (node.source.value === "react")
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            continue;
          const binding = module.scopes.symbolFor(specifier.local);
          if (
            !binding ||
            !isNodeOfType(specifier, "ImportSpecifier") ||
            getImportedName(specifier) === "default"
          ) {
            if (
              !binding ||
              binding.references.some(
                (reference) => !isTypeScriptTypePosition(reference.identifier),
              )
            )
              closed = false;
          } else if (
            !hasOnlyReferences(binding, module, (reference) => {
              const root = findTransparentExpressionRoot(reference);
              return callOf(root.parent)?.callee === root;
            })
          )
            closed = false;
        }
      return false;
    }
    if (
      isNodeOfType(node, "Property") &&
      (node.kind !== "init" ||
        node.computed ||
        (getStaticPropertyKeyName(node) === "getFiles" && isFunctionLike(node.value)))
    )
      closed = false;
    if (isNodeOfType(node, "CallExpression") && !findEnclosingFunction(node))
      topLevelCalls.push(node);
    if (isNodeOfType(node, "MemberExpression") && node.computed) closed = false;
    if (isNodeOfType(node, "JSXSpreadAttribute")) closed = false;
    if (isNodeOfType(node, "JSXAttribute") && getJsxAttributeName(node.name) === "is")
      closed = false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      READINESS_MEMBER_CAPABILITIES.has(memberName(node) ?? "")
    )
      closed = false;
    if (
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    ) {
      if (!findEnclosingFunction(node)) closed = false;
      const target = isNodeOfType(node, "AssignmentExpression") ? node.left : node.argument;
      if (
        READINESS_MEMBER_CAPABILITIES.has(memberName(stripParenExpression(target)) ?? "") ||
        ["postMessage", "contentWindow", "addEventListener", "removeEventListener"].includes(
          memberName(stripParenExpression(target)) ?? "",
        )
      )
        closed = false;
    }
    if (
      isNodeOfType(node, "AssignmentPattern") &&
      !(
        isNodeOfType(node.right, "Literal") &&
        (node.right.value === null ||
          ["string", "number", "boolean"].includes(typeof node.right.value))
      )
    )
      closed = false;
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (node.name === "arguments" || READINESS_CAPABILITY_NAMES.has(node.name)) closed = false;
    if (node.name === "window" && !module.scopes.isGlobalReference(node)) closed = false;
    if (!module.scopes.isGlobalReference(node)) return;
    if (node.name === "window") {
      const member = node.parent;
      const call = callOf(member?.parent);
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== node ||
        member.optional ||
        (memberName(member) !== "addEventListener" &&
          memberName(member) !== "removeEventListener") ||
        !call ||
        call.callee !== member ||
        !isLiteral(call.arguments[0], "message")
      )
        closed = false;
    }
  });
  const proof = { program: module.program, closed, topLevelCalls };
  closedProgramsByScopes.set(module.scopes, proof);
  return proof;
};

const isClosedProgram = (module: ReadinessModule, sourceText: string): boolean => {
  if (sourceText.includes("@jsx")) return false;
  const proof = getClosedProgramProof(module);
  return (
    proof.closed && proof.topLevelCalls.every((call) => isReactCall(call, "forwardRef", module))
  );
};

const loadImmediateModule = (
  identifier: EsTreeNode,
  owner: ReadinessModule,
): { module: ReadinessModule; value: EsTreeNode } | null => {
  const binding = owner.scopes.symbolFor(identifier);
  const declaration = binding && getImportDeclarationForSymbol(binding);
  if (
    !binding ||
    !declaration ||
    declaration.importKind === "type" ||
    !isNodeOfType(binding.declarationNode, "ImportSpecifier") ||
    binding.declarationNode.importKind === "type" ||
    typeof declaration.source.value !== "string" ||
    !declaration.source.value.startsWith(".")
  )
    return null;
  const importedName = getImportedName(binding.declarationNode);
  if (!importedName) return null;
  const immediatePath = resolveModulePath(owner.filename, declaration.source.value);
  const resolved = resolveCrossFileValueExportWithFilePath(
    owner.filename,
    declaration.source.value,
    importedName,
  );
  if (!immediatePath || !resolved || resolved.filePath !== immediatePath) return null;
  if (!isNodeOfType(resolved.programNode, "Program")) return null;
  for (const statement of resolved.programNode.body) {
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) return null;
    if (!isNodeOfType(statement, "ExportNamedDeclaration") || statement.exportKind === "type")
      continue;
    const exported = statement.declaration;
    if (
      isNodeOfType(exported, "TSInterfaceDeclaration") ||
      isNodeOfType(exported, "TSTypeAliasDeclaration")
    )
      continue;
    if (exported === resolved.exportedNode) continue;
    if (
      isNodeOfType(exported, "VariableDeclaration") &&
      exported.declarations.length === READINESS_SINGLE_VALUE_COUNT &&
      exported.declarations[0]?.init &&
      stripParenExpression(exported.declarations[0].init) === resolved.exportedNode
    )
      continue;
    if (
      exported ||
      statement.source ||
      statement.specifiers.some(
        (specifier) =>
          !isNodeOfType(specifier, "ExportSpecifier") ||
          (specifier.exportKind !== "type" &&
            (!isNodeOfType(specifier.exported, "Identifier") ||
              specifier.exported.name !== importedName)),
      )
    )
      return null;
  }
  for (const statement of isNodeOfType(owner.program, "Program") ? owner.program.body : []) {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      typeof statement.source.value !== "string"
    )
      continue;
    if (resolveModulePath(owner.filename, statement.source.value) !== immediatePath) continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier.local === binding.bindingIdentifier ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
      )
        continue;
      if (
        !isNodeOfType(specifier, "ImportSpecifier") ||
        getImportedName(specifier) === importedName
      )
        return null;
    }
  }
  let scopes = immediateModuleScopes.get(resolved.programNode);
  if (!scopes) {
    scopes = analyzeScopes(resolved.programNode);
    immediateModuleScopes.set(resolved.programNode, scopes);
  }
  const module = {
    filename: resolved.filePath,
    program: resolved.programNode,
    scopes,
  };
  let text: string;
  try {
    text = readFileSync(resolved.filePath, "utf8");
  } catch {
    return null;
  }
  return isClosedProgram(module, text) ? { module, value: resolved.exportedNode } : null;
};

const objectProperty = (node: EsTreeNode, name: string): EsTreeNode | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const properties = node.properties.filter(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      property.kind === "init" &&
      getStaticPropertyKeyName(property) === name,
  );
  return properties.length === READINESS_SINGLE_VALUE_COUNT &&
    isNodeOfType(properties[0], "Property")
    ? properties[0].value
    : null;
};

const getConstCallback = (
  binding: SymbolDescriptor,
  module: ReadinessModule,
): EsTreeNodeOfType<"ArrowFunctionExpression"> | null => {
  const initializer = getDirectConstInitializer(binding);
  const call = callOf(initializer);
  const callback = call?.arguments[0];
  return call &&
    isReactCall(call, "useCallback", module) &&
    isNodeOfType(callback, "ArrowFunctionExpression") &&
    !callback.async &&
    call.arguments.length === READINESS_PROTOCOL_ARGUMENT_COUNT &&
    hasOnlyReferences(binding, module, () => true)
    ? callback
    : null;
};

const isPassiveStyle = (
  node: EsTreeNode,
  module: ReadinessModule,
  seen = new Set<SymbolDescriptor>(),
): boolean => {
  const value = stripParenExpression(node);
  if (isNodeOfType(value, "Literal"))
    return value.value === null || ["string", "number", "boolean"].includes(typeof value.value);
  if (isNodeOfType(value, "ObjectExpression"))
    return value.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        property.kind === "init" &&
        isPassiveStyle(property.value, module, seen),
    );
  if (isNodeOfType(value, "ConditionalExpression")) {
    const condition = isNodeOfType(value.test, "Identifier") && module.scopes.symbolFor(value.test);
    return Boolean(
      condition &&
      hasOnlyReferences(condition, module, () => true) &&
      isPassiveStyle(value.consequent, module, seen) &&
      isPassiveStyle(value.alternate, module, seen),
    );
  }
  if (!isNodeOfType(value, "Identifier")) return false;
  const binding = module.scopes.symbolFor(value);
  const initializer = binding && getDirectConstInitializer(binding);
  return Boolean(
    binding &&
    initializer &&
    !seen.has(binding) &&
    hasOnlyReferences(binding, module, () => true) &&
    isPassiveStyle(initializer, module, new Set(seen).add(binding)),
  );
};

const nativeFrame = (
  element: EsTreeNode,
  attach: SymbolDescriptor,
  consumer: ReadinessModule,
): boolean => {
  if (
    !isNodeOfType(element, "JSXElement") ||
    !isNodeOfType(element.openingElement.name, "JSXIdentifier")
  )
    return false;
  if (element.openingElement.name.name === "iframe") {
    const reference = getAuthoritativeJsxAttribute(element.openingElement.attributes, "ref");
    const source = getAuthoritativeJsxAttribute(element.openingElement.attributes, "src");
    const referenceValue =
      reference &&
      isNodeOfType(reference.value, "JSXExpressionContainer") &&
      reference.value.expression;
    return Boolean(
      referenceValue &&
      source &&
      sameBinding(referenceValue, attach, consumer) &&
      isNodeOfType(element.parent, "ReturnStatement") &&
      element.parent.argument === element &&
      element.openingElement.attributes.every(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          READINESS_NATIVE_IFRAME_ATTRIBUTES.has(getJsxAttributeName(attribute.name) ?? ""),
      ) &&
      hasOnlyReferences(attach, consumer, (node) => node === referenceValue),
    );
  }
  const imported = loadImmediateModule(element.openingElement.name, consumer);
  if (!imported) return false;
  const { module, value } = imported;
  const factory = callOf(value);
  const component = factory?.arguments[0];
  const factoryDeclarator = value.parent;
  const exportedBinding =
    isNodeOfType(factoryDeclarator, "VariableDeclarator") &&
    module.scopes.symbolFor(factoryDeclarator.id);
  if (
    !factory ||
    !isReactCall(factory, "forwardRef", module) ||
    factory.arguments.length !== READINESS_SINGLE_VALUE_COUNT ||
    !exportedBinding ||
    !hasOnlyReferences(exportedBinding, module, (node) =>
      isNodeOfType(node.parent, "ExportSpecifier"),
    ) ||
    !isFunctionLike(component) ||
    component.async ||
    component.generator ||
    component.params.length !== READINESS_PROTOCOL_ARGUMENT_COUNT
  )
    return false;
  const [props, forwarded] = component.params;
  if (
    !isNodeOfType(props, "Identifier") ||
    !isNodeOfType(forwarded, "Identifier") ||
    !isNodeOfType(component.body, "BlockStatement")
  )
    return false;
  const [destructure, returned, ...extraStatements] = component.body.body;
  if (
    extraStatements.length ||
    !isNodeOfType(destructure, "VariableDeclaration") ||
    destructure.kind !== "const" ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument
  )
    return false;
  const propsBinding = module.scopes.symbolFor(props);
  if (!propsBinding) return false;
  const [declarator, ...extraDeclarators] = destructure.declarations;
  if (
    !declarator ||
    extraDeclarators.length ||
    !isNodeOfType(declarator.id, "ObjectPattern") ||
    (declarator.init !== props &&
      (!declarator.init || !sameBinding(declarator.init, propsBinding, module)))
  )
    return false;
  const sourceProperty = declarator.id.properties.find(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      getStaticPropertyKeyName(property) === "src",
  );
  if (
    !isNodeOfType(sourceProperty, "Property") ||
    !isNodeOfType(sourceProperty.value, "Identifier")
  )
    return false;
  const sourceBinding = module.scopes.symbolFor(sourceProperty.value);
  const forwardedBinding = module.scopes.symbolFor(forwarded);
  if (!sourceBinding || !forwardedBinding || !propsBinding) return false;
  const nativeElements: EsTreeNodeOfType<"JSXElement">[] = [];
  walkAst(returned.argument, (node) => {
    if (
      isNodeOfType(node, "JSXElement") &&
      isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
      node.openingElement.name.name === "iframe"
    )
      nativeElements.push(node);
  });
  if (nativeElements.length !== READINESS_SINGLE_VALUE_COUNT) return false;
  const iframe = nativeElements[0];
  const reference = getAuthoritativeJsxAttribute(iframe.openingElement.attributes, "ref");
  if (
    iframe.openingElement.attributes.some((attribute) => {
      if (!isNodeOfType(attribute, "JSXAttribute")) return true;
      if (["ref", "src"].includes(getJsxAttributeName(attribute.name) ?? "")) return false;
      if (!attribute.value) return false;
      return (
        !isNodeOfType(attribute.value, "Literal") &&
        !(
          isNodeOfType(attribute.value, "JSXExpressionContainer") &&
          isPassiveStyle(attribute.value.expression, module)
        )
      );
    })
  )
    return false;
  const source = getAuthoritativeJsxAttribute(iframe.openingElement.attributes, "src");
  if (
    !reference ||
    !source ||
    !isNodeOfType(reference.value, "JSXExpressionContainer") ||
    !isNodeOfType(source.value, "JSXExpressionContainer") ||
    !sameBinding(reference.value.expression, forwardedBinding, module) ||
    !sameBinding(source.value.expression, sourceBinding, module) ||
    iframe.openingElement.attributes.some(
      (attribute) =>
        !isNodeOfType(attribute, "JSXAttribute") ||
        !READINESS_NATIVE_IFRAME_ATTRIBUTES.has(getJsxAttributeName(attribute.name) ?? ""),
    )
  )
    return false;
  const returnedElement = stripParenExpression(returned.argument);
  let cursor: EsTreeNode = iframe;
  while (cursor !== returnedElement) {
    const parent: EsTreeNode | null | undefined = cursor.parent;
    if (
      !isNodeOfType(parent, "JSXElement") ||
      !parent.children.some((child) => child === cursor) ||
      parent.children.some(
        (child) => child !== cursor && !(isNodeOfType(child, "JSXText") && !child.value.trim()),
      )
    )
      return false;
    const opening = parent.openingElement;
    if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
    if (opening.name.name[0] === opening.name.name[0]?.toUpperCase()) {
      const card = directImport(opening.name, module, "@sanity/ui", "Card");
      if (
        !card ||
        !hasOnlyReferences(
          card,
          module,
          (node) => node.parent === opening || node.parent === parent.closingElement,
        )
      )
        return false;
    } else if (
      !HTML_TAGS.has(opening.name.name) ||
      VOID_DOM_ELEMENTS.has(opening.name.name) ||
      READINESS_INACTIVE_IFRAME_CONTAINERS.has(opening.name.name)
    )
      return false;
    if (
      opening.attributes.some(
        (attribute) =>
          !isNodeOfType(attribute, "JSXAttribute") ||
          getJsxAttributeName(attribute.name) !== "style" ||
          !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
          !isPassiveStyle(attribute.value.expression, module),
      )
    )
      return false;
    cursor = parent;
  }
  const attached = getAuthoritativeJsxAttribute(element.openingElement.attributes, "ref");
  const attachedExpression =
    attached && isNodeOfType(attached.value, "JSXExpressionContainer")
      ? attached.value.expression
      : null;
  const referenceExpression = reference.value.expression;
  const sourceExpression = source.value.expression;
  const componentBinding = consumer.scopes.symbolFor(element.openingElement.name);
  const parent = element.parent;
  if (
    !componentBinding ||
    !hasOnlyReferences(
      componentBinding,
      consumer,
      (node) => node.parent === element.openingElement || node.parent === element.closingElement,
    ) ||
    !isNodeOfType(parent, "ReturnStatement") ||
    parent.argument !== element ||
    element.openingElement.attributes.some(
      (attribute) =>
        !isNodeOfType(attribute, "JSXAttribute") ||
        !["ref", "src", "hidden"].includes(getJsxAttributeName(attribute.name) ?? ""),
    )
  )
    return false;
  return Boolean(
    attached &&
    isNodeOfType(attached.value, "JSXExpressionContainer") &&
    sameBinding(attached.value.expression, attach, consumer) &&
    hasOnlyReferences(attach, consumer, (node) => node === attachedExpression) &&
    hasOnlyReferences(forwardedBinding, module, (node) => node === referenceExpression) &&
    hasOnlyReferences(sourceBinding, module, (node) => node === sourceExpression) &&
    hasOnlyReferences(propsBinding, module, (node) => node === declarator.init),
  );
};

const isFrameWindow = (
  node: EsTreeNode,
  frame: SymbolDescriptor,
  module: ReadinessModule,
): boolean => {
  const candidate = stripParenExpression(node);
  return (
    isNodeOfType(candidate, "MemberExpression") &&
    memberName(candidate) === "contentWindow" &&
    sameBinding(candidate.object, frame, module)
  );
};

const nativeBridge = (
  send: SymbolDescriptor,
  receive: SymbolDescriptor,
  consumer: ReadinessModule,
): ReadinessBridge | null => {
  const declarator = send.declarationNode;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ObjectPattern") ||
    declarator.id.properties.length !== READINESS_PROTOCOL_ARGUMENT_COUNT ||
    declarator.id.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") ||
        property.computed ||
        !isNodeOfType(property.value, "Identifier"),
    )
  )
    return null;
  const invocation = callOf(declarator.init);
  if (
    !invocation ||
    !isNodeOfType(invocation.callee, "Identifier") ||
    invocation.arguments.length !== READINESS_PROTOCOL_ARGUMENT_COUNT ||
    !sameBinding(invocation.arguments[1], receive, consumer)
  )
    return null;
  const imported = loadImmediateModule(invocation.callee, consumer);
  if (
    !imported ||
    !isFunctionLike(imported.value) ||
    imported.value.async ||
    imported.value.generator ||
    imported.value.params.length !== READINESS_PROTOCOL_ARGUMENT_COUNT ||
    !isNodeOfType(imported.value.body, "BlockStatement")
  )
    return null;
  const hook = imported.value;
  const hookBody = imported.value.body;
  const module = imported.module;
  const [originParameter, callbackParameter] = hook.params;
  if (
    !isNodeOfType(originParameter, "Identifier") ||
    !isNodeOfType(callbackParameter, "Identifier")
  )
    return null;
  const origin = module.scopes.symbolFor(originParameter);
  const callback = module.scopes.symbolFor(callbackParameter);
  const returned = hookBody.body[hookBody.body.length - 1];
  if (
    !origin ||
    !callback ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "ObjectExpression") ||
    returned.argument.properties.length !== READINESS_PROTOCOL_ARGUMENT_COUNT ||
    returned.argument.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") || property.computed || property.kind !== "init",
    )
  )
    return null;
  const selectedProperty = declarator.id.properties.find(
    (property) => isNodeOfType(property, "Property") && property.value === send.bindingIdentifier,
  );
  if (!isNodeOfType(selectedProperty, "Property")) return null;
  const selectedName = getStaticPropertyKeyName(selectedProperty);
  const sendValue = selectedName ? objectProperty(returned.argument, selectedName) : null;
  const sender = isNodeOfType(sendValue, "Identifier") ? module.scopes.symbolFor(sendValue) : null;
  const senderFunction = sender ? getConstCallback(sender, module) : null;
  const messageParameter = senderFunction?.params[0];
  if (
    !sender ||
    !senderFunction ||
    senderFunction.params.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(messageParameter, "Identifier") ||
    !isNodeOfType(senderFunction.body, "BlockStatement")
  )
    return null;
  const [senderGuard, ...extraSenderStatements] = senderFunction.body.body;
  if (
    extraSenderStatements.length ||
    !isNodeOfType(senderGuard, "IfStatement") ||
    senderGuard.alternate ||
    !isNodeOfType(senderGuard.consequent, "BlockStatement")
  )
    return null;
  const senderTest = stripParenExpression(senderGuard.test);
  if (
    memberName(senderTest) !== "contentWindow" ||
    !isNodeOfType(senderTest, "MemberExpression") ||
    !isNodeOfType(senderTest.object, "Identifier")
  )
    return null;
  const frame = module.scopes.symbolFor(senderTest.object);
  const frameDeclarator = frame?.declarationNode;
  if (
    !frame ||
    !isNodeOfType(frameDeclarator, "VariableDeclarator") ||
    !isNodeOfType(frameDeclarator.id, "ArrayPattern")
  )
    return null;
  const frameState = callOf(frameDeclarator.init);
  const frameSetterIdentifier = frameDeclarator.id.elements[1];
  const frameSetter =
    isNodeOfType(frameSetterIdentifier, "Identifier") &&
    module.scopes.symbolFor(frameSetterIdentifier);
  if (
    !isNodeOfType(frameDeclarator.parent, "VariableDeclaration") ||
    frameDeclarator.parent.kind !== "const" ||
    !frameState ||
    !isReactCall(frameState, "useState", module) ||
    frameState.arguments.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isLiteral(frameState.arguments[0], null) ||
    !frameSetter
  )
    return null;
  const [sendStatement, ...extraSendStatements] = senderGuard.consequent.body;
  const sendCall = callOf(expressionOf(sendStatement));
  const sendCallee = sendCall && stripParenExpression(sendCall.callee);
  const sentMessage = module.scopes.symbolFor(messageParameter);
  if (
    extraSendStatements.length ||
    !sendCall ||
    !isNodeOfType(sendCallee, "MemberExpression") ||
    memberName(sendCallee) !== "postMessage" ||
    !isFrameWindow(sendCallee.object, frame, module) ||
    sendCall.arguments.length !== READINESS_PROTOCOL_ARGUMENT_COUNT ||
    !sentMessage ||
    !sameBinding(sendCall.arguments[0], sentMessage, module) ||
    !sameBinding(sendCall.arguments[1], origin, module)
  )
    return null;
  const delegates: EsTreeNodeOfType<"CallExpression">[] = [];
  const registrations: EsTreeNodeOfType<"CallExpression">[] = [];
  const unregistrations: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(hook.body, (node) => {
    const call = callOf(node);
    if (!call) return;
    if (sameBinding(call.callee, callback, module)) delegates.push(call);
    const callee = stripParenExpression(call.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isNodeOfType(callee.object, "Identifier") ||
      callee.object.name !== "window" ||
      !module.scopes.isGlobalReference(callee.object)
    )
      return;
    if (memberName(callee) === "addEventListener") registrations.push(call);
    if (memberName(callee) === "removeEventListener") unregistrations.push(call);
  });
  const delegate = delegates[0];
  const register = registrations[0];
  const unregister = unregistrations[0];
  if (
    delegates.length !== READINESS_SINGLE_VALUE_COUNT ||
    registrations.length !== READINESS_SINGLE_VALUE_COUNT ||
    unregistrations.length !== READINESS_SINGLE_VALUE_COUNT ||
    !delegate ||
    !register ||
    !unregister ||
    delegate.arguments.length !== READINESS_PROTOCOL_ARGUMENT_COUNT ||
    !sameBinding(delegate.arguments[1], sender, module)
  )
    return null;
  const data = stripParenExpression(delegate.arguments[0]);
  if (
    memberName(data) !== "data" ||
    !isNodeOfType(data, "MemberExpression") ||
    !isNodeOfType(data.object, "Identifier")
  )
    return null;
  const handler = findEnclosingFunction(delegate);
  const event = module.scopes.symbolFor(data.object);
  if (
    !handler ||
    !isNodeOfType(handler, "ArrowFunctionExpression") ||
    handler.async ||
    handler.params.length !== READINESS_SINGLE_VALUE_COUNT ||
    !event ||
    !sameBinding(handler.params[0], event, module) ||
    !isNodeOfType(handler.body, "BlockStatement")
  )
    return null;
  const [missingFrame, sourceGuard] = handler.body.body;
  if (
    !isNodeOfType(missingFrame, "IfStatement") ||
    missingFrame.alternate ||
    !isNodeOfType(missingFrame.test, "UnaryExpression") ||
    missingFrame.test.operator !== "!" ||
    !sameBinding(missingFrame.test.argument, frame, module) ||
    !isNodeOfType(missingFrame.consequent, "BlockStatement") ||
    missingFrame.consequent.body.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(missingFrame.consequent.body[0], "ReturnStatement") ||
    missingFrame.consequent.body[0].argument !== null ||
    !isNodeOfType(sourceGuard, "IfStatement") ||
    sourceGuard.alternate ||
    !isNodeOfType(sourceGuard.test, "BinaryExpression") ||
    sourceGuard.test.operator !== "!==" ||
    !isFrameWindow(sourceGuard.test.right, frame, module) ||
    memberName(sourceGuard.test.left) !== "source" ||
    !isNodeOfType(sourceGuard.test.left, "MemberExpression") ||
    !sameBinding(sourceGuard.test.left.object, event, module) ||
    !isNodeOfType(sourceGuard.consequent, "BlockStatement") ||
    sourceGuard.consequent.body.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(sourceGuard.consequent.body[0], "ReturnStatement") ||
    sourceGuard.consequent.body[0].argument !== null
  )
    return null;
  const delegateStatement = delegate.parent;
  if (
    !isNodeOfType(delegateStatement, "ExpressionStatement") ||
    delegateStatement.expression !== delegate
  )
    return null;
  let delegateRoot: EsTreeNode = delegateStatement;
  if (delegateStatement.parent !== handler.body) {
    const block = delegateStatement.parent;
    const guard = block?.parent;
    if (
      !isNodeOfType(block, "BlockStatement") ||
      block.body.length !== READINESS_SINGLE_VALUE_COUNT ||
      !isNodeOfType(guard, "IfStatement") ||
      guard.consequent !== block ||
      guard.alternate ||
      !sameBinding(guard.test, callback, module)
    )
      return null;
    delegateRoot = guard;
  }
  if (
    delegateRoot.parent !== handler.body ||
    handler.body.body.findIndex((statement) => statement === delegateRoot) <
      READINESS_SOURCE_GUARD_STATEMENT_COUNT
  )
    return null;
  const guardedSource = sourceGuard.test.left;
  if (
    !hasOnlyReferences(event, module, (reference) => {
      const member = reference.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== reference ||
        member.computed ||
        member.optional
      )
        return false;
      if (member === guardedSource) return true;
      if (memberName(member) !== "data") return false;
      if (member === data) return true;
      const field = member.parent;
      const comparison = field?.parent;
      return (
        isNodeOfType(field, "MemberExpression") &&
        field.object === member &&
        !field.computed &&
        !field.optional &&
        isNodeOfType(comparison, "BinaryExpression") &&
        (comparison.operator === "===" || comparison.operator === "!==") &&
        comparison.left === field &&
        isNodeOfType(comparison.right, "Literal") &&
        isNodeOfType(comparison.parent, "IfStatement") &&
        comparison.parent.test === comparison
      );
    })
  )
    return null;
  const handlerDeclarator = handler.parent;
  const handlerBinding =
    isNodeOfType(handlerDeclarator, "VariableDeclarator") &&
    module.scopes.symbolFor(handlerDeclarator.id);
  const listenerEffect = findEnclosingFunction(handlerDeclarator ?? handler);
  if (!handlerBinding || !listenerEffect || !isFunctionLike(listenerEffect)) return null;
  const effectCall = listenerEffect.parent;
  const listenerBody = listenerEffect.body;
  if (
    !isNodeOfType(listenerBody, "BlockStatement") ||
    !isNodeOfType(effectCall, "CallExpression") ||
    !isReactCall(effectCall, "useEffect", module)
  )
    return null;
  const [handlerDeclaration, registration, cleanup, ...extraEffectStatements] = listenerBody.body;
  const cleanupFunction = isNodeOfType(cleanup, "ReturnStatement") && cleanup.argument;
  if (
    extraEffectStatements.length ||
    handlerDeclaration !== handlerDeclarator.parent ||
    expressionOf(registration) !== register ||
    !cleanupFunction ||
    !isFunctionLike(cleanupFunction) ||
    (getSingleReturnExpression(cleanupFunction) !== unregister &&
      !(
        isNodeOfType(cleanupFunction.body, "BlockStatement") &&
        cleanupFunction.body.body.length === READINESS_SINGLE_VALUE_COUNT &&
        expressionOf(cleanupFunction.body.body[0]) === unregister
      ))
  )
    return null;
  if (
    ![register, unregister].every(
      (call) =>
        call.arguments.length === READINESS_MESSAGE_LISTENER_ARGUMENT_COUNT &&
        isLiteral(call.arguments[0], "message") &&
        sameBinding(call.arguments[1], handlerBinding, module) &&
        isLiteral(call.arguments[2], false),
    ) ||
    !hasOnlyReferences(
      handlerBinding,
      module,
      (node) => node === register!.arguments[1] || node === unregister!.arguments[1],
    )
  )
    return null;
  const remainingProperty = declarator.id.properties.find(
    (property) => property !== selectedProperty,
  );
  if (
    !isNodeOfType(remainingProperty, "Property") ||
    !isNodeOfType(remainingProperty.value, "Identifier")
  )
    return null;
  const remainingName = getStaticPropertyKeyName(remainingProperty);
  const attachValue = remainingName && objectProperty(returned.argument, remainingName);
  const attach = consumer.scopes.symbolFor(remainingProperty.value);
  if (
    !attach ||
    !isNodeOfType(attachValue, "Identifier") ||
    !sameBinding(attachValue, frameSetter, module)
  )
    return null;
  const missingFrameReference = missingFrame.test.argument;
  const sourceWindow = stripParenExpression(sourceGuard.test.right);
  const sendWindow = stripParenExpression(sendCallee.object);
  if (
    !hasOnlyReferences(frameSetter, module, (node) => node === attachValue) ||
    !hasOnlyReferences(sentMessage, module, (node) => node === sendCall.arguments[0]) ||
    !hasOnlyReferences(
      origin,
      module,
      (node) => node === sendCall.arguments[1] || isDependency(node, module),
    ) ||
    !hasOnlyReferences(callback, module, (node) => {
      const parent = node.parent;
      return (
        node === delegate!.callee ||
        (isNodeOfType(parent, "IfStatement") && parent.test === node) ||
        isDependency(node, module)
      );
    }) ||
    !hasOnlyReferences(frame, module, (node) => {
      const access = node.parent;
      return (
        node === missingFrameReference ||
        isDependency(node, module) ||
        access === senderTest ||
        (isNodeOfType(access, "MemberExpression") &&
          (access === sourceWindow || access === sendWindow))
      );
    }) ||
    !hasOnlyReferences(
      sender,
      module,
      (node) =>
        node === sendValue ||
        node === delegate!.arguments[1] ||
        isDependency(node, module) ||
        (callOf(node.parent)?.callee === node && findEnclosingFunction(node) === handler),
    )
  )
    return null;
  const iframes: EsTreeNode[] = [];
  walkAst(consumer.program, (node) => {
    if (!isNodeOfType(node, "JSXElement")) return;
    const reference = getAuthoritativeJsxAttribute(node.openingElement.attributes, "ref");
    if (
      reference &&
      isNodeOfType(reference.value, "JSXExpressionContainer") &&
      sameBinding(reference.value.expression, attach, consumer)
    )
      iframes.push(node);
  });
  const iframe = iframes[0];
  const importedBinding = consumer.scopes.symbolFor(invocation.callee);
  return iframes.length === READINESS_SINGLE_VALUE_COUNT &&
    iframe &&
    importedBinding &&
    hasOnlyReferences(importedBinding, consumer, (node) => node === invocation.callee) &&
    hasOnlyReferences(receive, consumer, (node) => node === invocation.arguments[1]) &&
    nativeFrame(iframe, attach, consumer)
    ? { send, attach }
    : null;
};

const isUploaderReference = (node: EsTreeNode, module: ReadinessModule): boolean => {
  if (isDependency(node, module)) return true;
  const parent = node.parent;
  if (
    (isNodeOfType(parent, "IfStatement") && parent.test === node) ||
    (isNodeOfType(parent, "LogicalExpression") && parent.operator === "&&")
  )
    return true;
  if (
    isNodeOfType(parent, "BinaryExpression") &&
    parent.operator === "in" &&
    parent.right === node &&
    isLiteral(parent.left, "signalCompletion")
  )
    return true;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === node &&
    !parent.computed &&
    !parent.optional
  ) {
    const method = memberName(parent);
    const root = findTransparentExpressionRoot(parent);
    if (
      ["getFiles", "subscribe", "updateFile", "signalCompletion"].includes(method ?? "") &&
      callOf(root.parent)?.callee === root
    )
      return true;
    return (
      method === "signalCompletion" &&
      isNodeOfType(root.parent, "UnaryExpression") &&
      root.parent.operator === "typeof"
    );
  }
  if (
    !isNodeOfType(parent, "Property") ||
    parent.value !== node ||
    parent.computed ||
    getStaticPropertyKeyName(parent) !== "uploader" ||
    !isNodeOfType(parent.parent, "ObjectExpression")
  )
    return false;
  const object = parent.parent;
  const assignment = object.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.right !== object ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    memberName(assignment.left) !== "current" ||
    !isNodeOfType(assignment.left.object, "Identifier")
  )
    return false;
  const cache = module.scopes.symbolFor(assignment.left.object);
  const initializer = cache && getDirectConstInitializer(cache);
  if (!cache || !initializer || !isReactCall(initializer, "useRef", module)) return false;
  return (
    hasCompleteSymbolReferences(cache, module.program, module.scopes) &&
    cache.references.every((entry) => {
      if (entry.flag !== "read") return false;
      const reference = entry.identifier;
      if (isDependency(reference, module)) return true;
      const current = reference.parent;
      if (
        !isNodeOfType(current, "MemberExpression") ||
        current.computed ||
        memberName(current) !== "current"
      )
        return false;
      if (current === assignment.left) return true;
      const access = findTransparentExpressionRoot(current).parent;
      return isNodeOfType(access, "MemberExpression") && memberName(access) === "unsubscribe";
    })
  );
};

const declaredSnapshotOwner = (
  identifier: EsTreeNode,
  module: ReadinessModule,
): SymbolDescriptor | null => {
  const binding = module.scopes.symbolFor(identifier);
  const declarator = binding?.declarationNode;
  if (
    !binding ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ObjectPattern") ||
    !isNodeOfType(declarator.init, "Identifier")
  )
    return null;
  const props = module.scopes.symbolFor(declarator.init);
  if (
    !props ||
    props.kind !== "parameter" ||
    !isNodeOfType(props.bindingIdentifier, "Identifier") ||
    !hasOnlyReferences(
      props,
      module,
      (node) =>
        isNodeOfType(node.parent, "VariableDeclarator") &&
        node.parent.init === node &&
        isNodeOfType(node.parent.id, "ObjectPattern") &&
        node.parent.id.properties.every(
          (property) =>
            isNodeOfType(property, "Property") &&
            !property.computed &&
            isNodeOfType(property.value, "Identifier"),
        ),
    )
  )
    return null;
  const annotation = props.bindingIdentifier.typeAnnotation?.typeAnnotation;
  if (
    !isNodeOfType(annotation, "TSTypeReference") ||
    !isNodeOfType(annotation.typeName, "Identifier") ||
    hasEnclosingTypeParameterNamed(annotation, annotation.typeName.name)
  )
    return null;
  const annotationName = annotation.typeName.name;
  let matchingTypeDeclarations = 0;
  walkAst(module.program, (node) => {
    if (
      (isNodeOfType(node, "TSInterfaceDeclaration") ||
        isNodeOfType(node, "TSTypeAliasDeclaration") ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression")) &&
      node.id?.name === annotationName
    )
      matchingTypeDeclarations += 1;
  });
  if (matchingTypeDeclarations !== READINESS_SINGLE_VALUE_COUNT) return null;
  const declarations = findSameFileTypeDeclarations(annotation, annotationName);
  const declaration = declarations[0];
  if (
    declarations.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(declaration, "TSInterfaceDeclaration") ||
    declaration.typeParameters ||
    (declaration.extends?.length ?? 0)
  )
    return null;
  const property = declarator.id.properties.find(
    (candidate) =>
      isNodeOfType(candidate, "Property") && candidate.value === binding.bindingIdentifier,
  );
  const propertyName = property && getStaticPropertyKeyName(property);
  const signature = declaration.body.body.find(
    (candidate) =>
      isNodeOfType(candidate, "TSPropertySignature") &&
      !candidate.computed &&
      ((isNodeOfType(candidate.key, "Identifier") && candidate.key.name === propertyName) ||
        (isNodeOfType(candidate.key, "Literal") && candidate.key.value === propertyName)),
  );
  const role =
    isNodeOfType(signature, "TSPropertySignature") && signature.typeAnnotation?.typeAnnotation;
  if (
    !isNodeOfType(role, "TSTypeReference") ||
    !isNodeOfType(role.typeName, "Identifier") ||
    hasEnclosingTypeParameterNamed(role, role.typeName.name) ||
    !directImport(role.typeName, module, "@sanity/types", "AssetSourceUploader", true)
  )
    return null;
  const manifest = readNearestPackageManifest(module.filename);
  return manifest &&
    [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ].some((section) => typeof section?.["@sanity/types"] === "string") &&
    hasOnlyReferences(binding, module, (node) => isUploaderReference(node, module))
    ? binding
    : null;
};

const isFreshRows = (binding: SymbolDescriptor, module: ReadinessModule): boolean => {
  const initializer = getDirectConstInitializer(binding);
  return (
    isNodeOfType(initializer, "ArrayExpression") &&
    initializer.elements.every(
      (element) =>
        isNodeOfType(element, "ObjectExpression") &&
        element.properties.every(
          (property) =>
            isNodeOfType(property, "Property") &&
            property.kind === "init" &&
            !property.computed &&
            isNodeOfType(property.value, "Literal") &&
            (property.value.value === null ||
              ["string", "number", "boolean"].includes(typeof property.value.value)),
        ),
    ) &&
    hasOnlyReferences(binding, module, (node) => {
      const parent = node.parent;
      return (
        node === module.snapshotPayload ||
        (isNodeOfType(parent, "MemberExpression") &&
          parent.object === node &&
          !parent.optional &&
          (memberName(parent) === "length" ||
            (memberName(parent) === "every" && callOf(parent.parent)?.callee === parent)))
      );
    })
  );
};

const snapshotRead = (
  node: EsTreeNode,
  owner: SymbolDescriptor,
  module: ReadinessModule,
): boolean => {
  if (sameBinding(node, owner, module)) return isFreshRows(owner, module);
  const call = callOf(node);
  return Boolean(
    call &&
    call.arguments.length === 0 &&
    isNodeOfType(call.callee, "MemberExpression") &&
    !call.callee.optional &&
    memberName(call.callee) === "getFiles" &&
    sameBinding(call.callee.object, owner, module),
  );
};

const snapshotPredicate = (
  node: EsTreeNode,
  owner: SymbolDescriptor,
  module: ReadinessModule,
): boolean => {
  const candidate = stripParenExpression(node);
  if (isNodeOfType(candidate, "LogicalExpression") && candidate.operator === "&&")
    return (
      snapshotPredicate(candidate.left, owner, module) &&
      snapshotPredicate(candidate.right, owner, module)
    );
  if (
    isNodeOfType(candidate, "BinaryExpression") &&
    candidate.operator === ">" &&
    isLiteral(candidate.right, 0) &&
    isNodeOfType(candidate.left, "MemberExpression") &&
    memberName(candidate.left) === "length"
  )
    return snapshotRead(candidate.left.object, owner, module);
  const call = callOf(candidate);
  const callee = call && stripParenExpression(call.callee);
  const callback = call?.arguments[0];
  if (
    !call ||
    call.arguments.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(callee, "MemberExpression") ||
    callee.optional ||
    memberName(callee) !== "every" ||
    !snapshotRead(callee.object, owner, module) ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(callback.params[0], "Identifier")
  )
    return false;
  const returned = getSingleReturnExpression(callback);
  const parameter = module.scopes.symbolFor(callback.params[0]);
  if (
    !parameter ||
    !isNodeOfType(returned, "BinaryExpression") ||
    returned.operator !== "===" ||
    !isNodeOfType(returned.left, "MemberExpression") ||
    returned.left.optional ||
    memberName(returned.left) !== "status" ||
    !sameBinding(returned.left.object, parameter, module) ||
    !isNodeOfType(returned.right, "Literal") ||
    typeof returned.right.value !== "string"
  )
    return false;
  const statusReceiver = returned.left.object;
  return hasOnlyReferences(parameter, module, (reference) => reference === statusReceiver);
};

const isMessageGuard = (
  node: EsTreeNode,
  parameter: SymbolDescriptor,
  module: ReadinessModule,
): Map<string, string> | null => {
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "&&") {
    const left = isMessageGuard(node.left, parameter, module);
    const right = isMessageGuard(node.right, parameter, module);
    if (
      !left ||
      !right ||
      [...right].some(([name, value]) => left.has(name) && left.get(name) !== value)
    )
      return null;
    return new Map([...left, ...right]);
  }
  if (
    !isNodeOfType(node, "BinaryExpression") ||
    node.operator !== "===" ||
    !isNodeOfType(node.left, "MemberExpression") ||
    node.left.optional ||
    !sameBinding(node.left.object, parameter, module) ||
    !memberName(node.left) ||
    !isNodeOfType(node.right, "Literal") ||
    typeof node.right.value !== "string"
  )
    return null;
  return new Map([[memberName(node.left)!, node.right.value]]);
};

export const hasNativeIframeReadinessConsumption = (
  effect: EsTreeNode,
  context: ReadinessContext,
): boolean => {
  if (!context.filename) return false;
  const effectCall = callOf(effect);
  const callback = effectCall?.arguments[0];
  const dependencies = effectCall?.arguments[1];
  const component = effectCall && findEnclosingFunction(effectCall);
  const program = effectCall && findProgramRoot(effectCall);
  if (
    !effectCall ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    !component ||
    !isFunctionLike(component) ||
    !program
  )
    return false;
  const module = { filename: context.filename, scopes: context.scopes, program };
  const states = collectUseStateBindings(component.body, context.scopes);
  if (
    states.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isReactCall(effectCall, "useEffect", module)
  )
    return false;
  const declaration = states[0].declarator;
  const stateCall = callOf(declaration.init);
  if (
    !stateCall ||
    !isReactCall(stateCall, "useState", module) ||
    stateCall.arguments.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isLiteral(stateCall.arguments[0], false) ||
    !isNodeOfType(declaration.id, "ArrayPattern")
  )
    return false;
  const stateIdentifier = declaration.id.elements[0];
  const setterIdentifier = declaration.id.elements[1];
  if (!isNodeOfType(stateIdentifier, "Identifier") || !isNodeOfType(setterIdentifier, "Identifier"))
    return false;
  const state = context.scopes.symbolFor(stateIdentifier);
  const setter = context.scopes.symbolFor(setterIdentifier);
  if (!state || !setter) return false;
  const consumption = setter.references.flatMap((reference) => {
    const call = callOf(reference.identifier.parent);
    return call && call.callee === reference.identifier && findEnclosingFunction(call) === callback
      ? [call]
      : [];
  });
  if (
    consumption.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isLiteral(consumption[0].arguments[0], false) ||
    consumption[0].arguments.length !== READINESS_SINGLE_VALUE_COUNT
  )
    return false;
  const consume = consumption[0];
  const consumeStatement = consume.parent;
  const pair = consumeStatement?.parent;
  if (
    !isNodeOfType(consumeStatement, "ExpressionStatement") ||
    !isNodeOfType(pair, "BlockStatement") ||
    pair.body.length !== READINESS_SEND_AND_CONSUME_STATEMENT_COUNT ||
    pair.body[1] !== consumeStatement
  )
    return false;
  const sendCall = callOf(expressionOf(pair.body[0]));
  const send =
    sendCall &&
    isNodeOfType(sendCall.callee, "Identifier") &&
    context.scopes.symbolFor(sendCall.callee);
  if (
    !send ||
    !sendCall ||
    sendCall.arguments.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(sendCall.arguments[0], "ObjectExpression")
  )
    return false;
  let readyGuard: EsTreeNodeOfType<"IfStatement"> | null = null;
  let branch: EsTreeNode = pair;
  let ancestor = pair.parent;
  const predicates: EsTreeNode[] = [];
  while (ancestor && ancestor !== callback) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (ancestor.consequent !== branch || ancestor.alternate) return false;
      if (sameBinding(ancestor.test, state, module)) readyGuard = ancestor;
      else predicates.push(ancestor.test);
    } else if (!isNodeOfType(ancestor, "BlockStatement")) return false;
    if (
      !readyGuard &&
      isNodeOfType(ancestor, "BlockStatement") &&
      ancestor.body.length !== READINESS_SINGLE_VALUE_COUNT
    )
      return false;
    branch = ancestor;
    ancestor = ancestor.parent;
  }
  if (
    !readyGuard ||
    ancestor !== callback ||
    !hasOnlyReferences(
      state,
      module,
      (node) =>
        node === readyGuard!.test ||
        (node.parent === dependencies && dependencies.elements.some((element) => element === node)),
    )
  )
    return false;
  const otherWrites = setter.references.flatMap((reference) => {
    if (reference.identifier === consume.callee) return [];
    const call = callOf(reference.identifier.parent);
    return call && call.callee === reference.identifier ? [call] : [];
  });
  if (
    otherWrites.length !== READINESS_PROTOCOL_ARGUMENT_COUNT ||
    !hasOnlyReferences(
      setter,
      module,
      (node) => node === consume.callee || otherWrites.some((call) => call.callee === node),
    )
  )
    return false;
  const receiverFunction = findEnclosingFunction(otherWrites[0]);
  if (
    !isNodeOfType(receiverFunction, "ArrowFunctionExpression") ||
    receiverFunction.async ||
    receiverFunction.params.length !== READINESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(receiverFunction.params[0], "Identifier") ||
    otherWrites.some((call) => findEnclosingFunction(call) !== receiverFunction)
  )
    return false;
  const receiverDeclarator = receiverFunction.parent?.parent;
  const receiver =
    isNodeOfType(receiverDeclarator, "VariableDeclarator") &&
    context.scopes.symbolFor(receiverDeclarator.id);
  const message = context.scopes.symbolFor(receiverFunction.params[0]);
  if (!receiver || !message || getConstCallback(receiver, module) !== receiverFunction)
    return false;
  const guards: Map<string, string>[] = [];
  const booleans = new Set<boolean>();
  for (const write of otherWrites) {
    if (
      write.arguments.length !== READINESS_SINGLE_VALUE_COUNT ||
      !isNodeOfType(write.arguments[0], "Literal") ||
      typeof write.arguments[0].value !== "boolean"
    )
      return false;
    const statement = write.parent;
    const block = statement?.parent;
    const guard = block?.parent;
    if (
      !isNodeOfType(statement, "ExpressionStatement") ||
      !isNodeOfType(block, "BlockStatement") ||
      block.body.length !== READINESS_SINGLE_VALUE_COUNT ||
      !isNodeOfType(guard, "IfStatement") ||
      guard.consequent !== block ||
      guard.alternate
    )
      return false;
    const facts = isMessageGuard(guard.test, message, module);
    if (!facts) return false;
    guards.push(facts);
    booleans.add(write.arguments[0].value);
  }
  if (
    booleans.size !== READINESS_PROTOCOL_ARGUMENT_COUNT ||
    ![...guards[0]].some(([name, value]) => guards[1].has(name) && guards[1].get(name) !== value)
  )
    return false;
  const payload = sendCall.arguments[0];
  const values = payload.properties.flatMap((property) =>
    isNodeOfType(property, "Property") && !isNodeOfType(property.value, "Literal")
      ? [property.value]
      : [],
  );
  const snapshot = values[0];
  if (values.length !== READINESS_SINGLE_VALUE_COUNT || !snapshot) return false;
  const snapshotCall = callOf(snapshot);
  const owner =
    snapshotCall &&
    isNodeOfType(snapshotCall.callee, "MemberExpression") &&
    isNodeOfType(snapshotCall.callee.object, "Identifier")
      ? declaredSnapshotOwner(snapshotCall.callee.object, module)
      : isNodeOfType(snapshot, "Identifier")
        ? context.scopes.symbolFor(snapshot)
        : null;
  const snapshotModule = { ...module, snapshotPayload: snapshot };
  if (
    !owner ||
    !snapshotRead(snapshot, owner, snapshotModule) ||
    payload.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") ||
        property.computed ||
        property.kind !== "init" ||
        !(
          property.value === snapshot ||
          (isNodeOfType(property.value, "Literal") &&
            (property.value.value === null ||
              ["string", "number", "boolean"].includes(typeof property.value.value)))
        ),
    )
  )
    return false;
  const isGuard = (node: EsTreeNode): boolean => {
    if (isNodeOfType(node, "LogicalExpression") && node.operator === "&&")
      return isGuard(node.left) && isGuard(node.right);
    if (snapshotPredicate(node, owner, snapshotModule)) return true;
    if (!isNodeOfType(node, "Identifier")) return false;
    const binding = context.scopes.symbolFor(node);
    const declaration = binding?.declarationNode;
    const origin =
      isNodeOfType(declaration, "VariableDeclarator") &&
      isNodeOfType(declaration.init, "Identifier") &&
      context.scopes.symbolFor(declaration.init);
    return Boolean(
      origin &&
      origin.kind === "parameter" &&
      binding &&
      binding.kind === "const" &&
      isNodeOfType(binding.declarationNode, "VariableDeclarator") &&
      isNodeOfType(binding.declarationNode.id, "ObjectPattern") &&
      hasOnlyReferences(binding, module, () => true),
    );
  };
  const sourceText = context.sourceText ?? context.sourceCode?.getText?.();
  return (
    predicates.every(isGuard) &&
    sourceText !== undefined &&
    isClosedProgram(module, sourceText) &&
    Boolean(nativeBridge(send, receiver, module)) &&
    hasOnlyReferences(send, module, (node) => {
      const call = callOf(node.parent);
      return (
        isDependency(node, module) ||
        Boolean(
          call &&
          call.callee === node &&
          call.arguments.length === READINESS_SINGLE_VALUE_COUNT &&
          isNodeOfType(call.arguments[0], "ObjectExpression"),
        )
      );
    })
  );
};
