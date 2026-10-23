import {
  RADIX_DRAFT_EMPTY_COUNT,
  RADIX_DRAFT_SINGLE_COUNT,
  RADIX_DRAFT_PAIR_COUNT,
  RADIX_DRAFT_THREE_STATEMENTS_COUNT,
  RADIX_DRAFT_FIRST_INDEX,
  RADIX_DRAFT_SECOND_INDEX,
  RADIX_DRAFT_LAST_INDEX,
  RADIX_DRAFT_MODULE_SOURCE,
  RADIX_DRAFT_MAX_BRIDGE_COUNT,
  RADIX_DRAFT_FORBIDDEN_ATTRIBUTES,
  RADIX_DRAFT_FORBIDDEN_CAPABILITIES,
  RADIX_DRAFT_FORBIDDEN_MEMBERS,
  RADIX_DRAFT_RUNTIME_TYPESCRIPT,
} from "./constants.js";
import { hasSupportedRadixReactCall } from "./has-supported-radix-react-call.js";
import { readFileSync } from "node:fs";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasJsxRuntimePragma } from "../../../utils/has-jsx-runtime-pragma.js";
import { parsePackageVersion } from "../../../utils/parse-package-version.js";
import { readNearestPackageManifest } from "../../../utils/read-nearest-package-manifest.js";
import { recordContentProbe } from "../../../utils/cross-file-probe-recorder.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasCurrentContextRecordEnvironment } from "./has-current-context-record-environment.js";
import { isAbsentPropertyEmptyRecordGroup } from "./is-absent-property-empty-record-group.js";

interface RadixDraftModule {
  readonly filename: string;
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly sourceText?: string;
}

interface RadixDraftComponent {
  readonly module: RadixDraftModule;
  readonly functionNode: EsTreeNode;
  readonly instance: EsTreeNode;
  readonly parent?: RadixDraftComponent;
  readonly copiedSource?: EsTreeNode;
  readonly mapper?: EsTreeNode;
}

interface RadixDraftDefaultValue {
  readonly kind: "absent" | "primitive" | "unknown";
  readonly value?: string | number | boolean | null;
}

interface RadixDraftModuleFacts {
  readonly sourceText: string;
  readonly valid: boolean;
}
const scopesByProgram = new WeakMap<EsTreeNode, ScopeAnalysis>();
const moduleFacts = new WeakMap<ScopeAnalysis, RadixDraftModuleFacts>();

const isExportedComponent = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  if (isNodeOfType(functionNode.parent, "ExportNamedDeclaration")) return true;
  const declarator = functionNode.parent;
  return Boolean(
    isNodeOfType(declarator, "VariableDeclarator") &&
    isNodeOfType(declarator.parent, "VariableDeclaration") &&
    declarator.parent.kind === "const" &&
    isNodeOfType(declarator.parent.parent, "ExportNamedDeclaration"),
  );
};

const getModule = (filename: string, program: EsTreeNode): RadixDraftModule => {
  let scopes = scopesByProgram.get(program);
  if (!scopes) {
    scopes = analyzeScopes(program);
    scopesByProgram.set(program, scopes);
  }
  recordContentProbe(filename);
  let sourceText: string | undefined;
  try {
    sourceText = readFileSync(filename, "utf8");
  } catch {
    sourceText = undefined;
  }
  return { filename, program, scopes, sourceText };
};

const sameBinding = (module: RadixDraftModule, left: EsTreeNode, right: EsTreeNode): boolean => {
  const symbol = module.scopes.symbolFor(left);
  return Boolean(symbol && symbol === module.scopes.symbolFor(right));
};

const readonlyBinding = (module: RadixDraftModule, symbol: SymbolDescriptor | null): boolean =>
  Boolean(
    symbol &&
    !isErasedTypeScriptBinding(symbol) &&
    hasCompleteSymbolReferences(symbol, module.program, module.scopes) &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    ),
  );

const returnedElement = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode) || functionNode.async || functionNode.generator) return null;
  if (!isNodeOfType(functionNode.body, "BlockStatement"))
    return isNodeOfType(functionNode.body, "JSXElement") ? functionNode.body : null;
  const statements = functionNode.body.body;
  const last = statements.at(RADIX_DRAFT_LAST_INDEX);
  if (
    !isNodeOfType(last, "ReturnStatement") ||
    !last.argument ||
    !isNodeOfType(stripParenExpression(last.argument), "JSXElement")
  )
    return null;
  let extraExit = false;
  for (const statement of statements.slice(RADIX_DRAFT_EMPTY_COUNT, -RADIX_DRAFT_SINGLE_COUNT)) {
    walkAst(statement, (node) => {
      if (isFunctionLike(node)) return false;
      if (isNodeOfType(node, "ReturnStatement") || isNodeOfType(node, "ThrowStatement"))
        extraExit = true;
    });
  }
  return extraExit ? null : stripParenExpression(last.argument);
};

const propertyBinding = (component: RadixDraftComponent, name: string): EsTreeNode | null => {
  const functionNode = component.functionNode;
  if (
    !isFunctionLike(functionNode) ||
    !isNodeOfType(functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern")
  )
    return null;
  for (const property of functionNode.params[RADIX_DRAFT_FIRST_INDEX].properties) {
    if (
      isNodeOfType(property, "Property") &&
      !property.computed &&
      getStaticPropertyKeyName(property) === name
    )
      return property.value;
  }
  return null;
};

const attributeExpression = (
  element: EsTreeNode,
  name: string,
  allowKnownRest = false,
): EsTreeNode | null => {
  if (!isNodeOfType(element, "JSXElement")) return null;
  let value: EsTreeNode | null = null;
  for (const attribute of element.openingElement.attributes) {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      if (!allowKnownRest) return null;
      continue;
    }
    if (!isNodeOfType(attribute, "JSXAttribute") || getJsxAttributeName(attribute.name) !== name)
      continue;
    if (!attribute.value) return attribute;
    value = isNodeOfType(attribute.value, "JSXExpressionContainer")
      ? stripParenExpression(attribute.value.expression)
      : attribute.value;
  }
  return value;
};

const defaultValue = (
  expression: EsTreeNode,
  component: RadixDraftComponent,
  visited = new Set<SymbolDescriptor>(),
  allowGrouping = true,
): RadixDraftDefaultValue => {
  const node = stripParenExpression(expression);
  if (
    isNodeOfType(node, "Literal") &&
    (node.value === null ||
      typeof node.value === "string" ||
      typeof node.value === "number" ||
      typeof node.value === "boolean")
  )
    return { kind: "primitive", value: node.value };
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
    const argument = defaultValue(node.argument, component, visited, allowGrouping);
    if (argument.kind === "absent") return { kind: "primitive", value: true };
    if (argument.kind === "primitive") return { kind: "primitive", value: !argument.value };
    return { kind: "unknown" };
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    const left = defaultValue(node.left, component, visited, allowGrouping);
    if (left.kind !== "absent" && left.kind !== "primitive") {
      const right = defaultValue(node.right, component, visited, allowGrouping);
      if (
        node.operator === "&&" &&
        (right.kind === "absent" || (right.kind === "primitive" && !right.value))
      )
        return { kind: "primitive", value: false };
      if (node.operator === "||" && right.kind === "primitive" && right.value)
        return { kind: "primitive", value: true };
      return { kind: "unknown" };
    }
    const truthy = left.kind === "primitive" && Boolean(left.value);
    const chooseRight =
      node.operator === "&&"
        ? truthy
        : node.operator === "||"
          ? !truthy
          : left.kind === "absent" || left.value === null;
    return chooseRight ? defaultValue(node.right, component, visited, allowGrouping) : left;
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    const test = defaultValue(node.test, component, visited, allowGrouping);
    if (test.kind !== "primitive" && test.kind !== "absent") return { kind: "unknown" };
    return defaultValue(
      test.kind === "primitive" && test.value ? node.consequent : node.alternate,
      component,
      visited,
      allowGrouping,
    );
  }
  if (allowGrouping && isNodeOfType(node, "CallExpression") && isEmptyGroupingCall(node, component))
    return { kind: "primitive", value: null };
  if (!isNodeOfType(node, "Identifier")) return { kind: "unknown" };
  const symbol = component.module.scopes.symbolFor(node);
  if (!readonlyBinding(component.module, symbol) || !symbol || visited.has(symbol))
    return { kind: "unknown" };
  const nextVisited = new Set(visited).add(symbol);
  const functionNode = component.functionNode;
  if (
    isFunctionLike(functionNode) &&
    isNodeOfType(functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern")
  ) {
    for (const property of functionNode.params[RADIX_DRAFT_FIRST_INDEX].properties) {
      if (!isNodeOfType(property, "Property") || property.computed) continue;
      const binding = isNodeOfType(property.value, "AssignmentPattern")
        ? property.value.left
        : property.value;
      if (component.module.scopes.symbolFor(binding) !== symbol) continue;
      const name = getStaticPropertyKeyName(property);
      if (!name) return { kind: "unknown" };
      if (component.parent) {
        const supplied = attributeExpression(component.instance, name);
        if (supplied) return defaultValue(supplied, component.parent, nextVisited, allowGrouping);
      }
      return isNodeOfType(property.value, "AssignmentPattern")
        ? defaultValue(property.value.right, component, nextVisited, allowGrouping)
        : { kind: "absent" };
    }
  }
  if (symbol.kind !== "const" || !symbol.initializer) return { kind: "unknown" };
  return defaultValue(symbol.initializer, component, nextVisited, allowGrouping);
};

const isInactiveDefaultBranch = (
  node: EsTreeNode,
  component: RadixDraftComponent,
  allowGrouping = true,
): boolean => {
  let child = node;
  let parent = child.parent;
  while (parent && parent !== component.functionNode) {
    if (isNodeOfType(parent, "ConditionalExpression")) {
      const value = defaultValue(parent.test, component, new Set(), allowGrouping);
      if (value.kind === "primitive" || value.kind === "absent") {
        const selected =
          value.kind === "primitive" && value.value ? parent.consequent : parent.alternate;
        if (selected !== child) return true;
      }
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
};

const isPassiveOptionPredicate = (
  callback: EsTreeNode,
  component: RadixDraftComponent,
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(callback.params[RADIX_DRAFT_FIRST_INDEX], "Identifier") ||
    isNodeOfType(callback.body, "BlockStatement")
  )
    return false;
  const parameter = component.module.scopes.symbolFor(callback.params[RADIX_DRAFT_FIRST_INDEX]);
  if (!parameter || !readonlyBinding(component.module, parameter)) return false;
  let valid = true;
  walkAst(callback.body, (node) => {
    if (
      isNodeOfType(node, "CallExpression") ||
      isFunctionLike(node) ||
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      isNodeOfType(node, "AwaitExpression") ||
      isNodeOfType(node, "YieldExpression") ||
      isNodeOfType(node, "JSXElement") ||
      isNodeOfType(node, "ObjectExpression") ||
      isNodeOfType(node, "ArrayExpression")
    )
      valid = false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      (node.computed ||
        node.optional ||
        !["value", "label"].includes(getStaticPropertyKeyName(node) ?? "") ||
        component.module.scopes.symbolFor(node.object) !== parameter)
    )
      valid = false;
    if (isNodeOfType(node, "Identifier") && !isNonReferenceIdentifier(node)) {
      const symbol = component.module.scopes.symbolFor(node);
      if (!symbol || !readonlyBinding(component.module, symbol)) valid = false;
      if (
        symbol === parameter &&
        (!isNodeOfType(node.parent, "MemberExpression") || node.parent.object !== node)
      )
        valid = false;
    }
  });
  return valid;
};

const hasOnlyPlainOptionUses = (
  symbol: SymbolDescriptor,
  component: RadixDraftComponent,
  visited: ReadonlySet<SymbolDescriptor>,
): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    if (isInactiveDefaultBranch(identifier, component, false)) return true;
    const parent = identifier.parent;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === identifier &&
      !parent.computed &&
      !parent.optional &&
      !isWithinAssignmentTarget(parent)
    ) {
      const name = getStaticPropertyKeyName(parent);
      if (name === "length") return true;
      const call = parent.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== parent ||
        call.optional ||
        call.arguments.length !== RADIX_DRAFT_SINGLE_COUNT
      )
        return false;
      const callback = call.arguments[RADIX_DRAFT_FIRST_INDEX];
      if (name === "map")
        return Boolean(
          component.mapper && sameBinding(component.module, callback, component.mapper),
        );
      const result = call.parent;
      return (
        name === "find" &&
        isPassiveOptionPredicate(callback, component) &&
        isNodeOfType(result, "MemberExpression") &&
        result.object === call &&
        !result.computed &&
        ["value", "label"].includes(getStaticPropertyKeyName(result) ?? "") &&
        !isWithinAssignmentTarget(result)
      );
    }
    if (isNodeOfType(parent, "ArrayExpression")) {
      const call = parent.parent;
      return (
        isNodeOfType(call, "CallExpression") &&
        call.arguments[RADIX_DRAFT_SECOND_INDEX] === parent &&
        ["useEffect", "useMemo", "useCallback"].some((name) =>
          hasSupportedRadixReactCall(call, name, component.module.scopes),
        )
      );
    }
    if (isNodeOfType(parent, "CallExpression"))
      return (
        parent.arguments[RADIX_DRAFT_FIRST_INDEX] === identifier &&
        isRecognizedGroupingCall(parent, component)
      );
    let selected: EsTreeNode = identifier;
    while (isNodeOfType(selected.parent, "ConditionalExpression")) {
      const conditional = selected.parent;
      const test = defaultValue(conditional.test, component);
      if (test.kind !== "primitive" && test.kind !== "absent") return false;
      if (
        (test.kind === "primitive" && test.value
          ? conditional.consequent
          : conditional.alternate) !== selected
      )
        return false;
      selected = conditional;
    }
    const declaration = selected.parent;
    if (
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== selected ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.kind !== "const"
    )
      return false;
    const alias = component.module.scopes.symbolFor(declaration.id);
    return Boolean(
      alias &&
      !visited.has(alias) &&
      readonlyBinding(component.module, alias) &&
      hasOnlyPlainOptionUses(alias, component, new Set(visited).add(alias)),
    );
  });

const isPlainOptionCollection = (
  expression: EsTreeNode,
  component: RadixDraftComponent,
  visited = new Set<SymbolDescriptor>(),
): boolean => {
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "ConditionalExpression")) {
    const test = defaultValue(node.test, component);
    if (test.kind !== "absent" && test.kind !== "primitive") return false;
    return isPlainOptionCollection(
      test.kind === "primitive" && test.value ? node.consequent : node.alternate,
      component,
      visited,
    );
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = component.module.scopes.symbolFor(node);
  if (
    !symbol ||
    !readonlyBinding(component.module, symbol) ||
    visited.has(symbol) ||
    !hasOnlyPlainOptionUses(symbol, component, new Set([symbol]))
  )
    return false;
  if (
    symbol.kind === "parameter" &&
    isFunctionLike(component.functionNode) &&
    isNodeOfType(component.functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern") &&
    isAstDescendant(
      symbol.bindingIdentifier,
      component.functionNode.params[RADIX_DRAFT_FIRST_INDEX],
    )
  )
    return !component.copiedSource || !sameBinding(component.module, node, component.copiedSource);
  return (
    symbol.kind === "const" &&
    Boolean(
      symbol.initializer &&
      isPlainOptionCollection(symbol.initializer, component, new Set(visited).add(symbol)),
    )
  );
};

const isRecognizedGroupingCall = (call: EsTreeNode, component: RadixDraftComponent): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const symbol = component.module.scopes.symbolFor(call.callee);
  if (!symbol || !readonlyBinding(component.module, symbol)) return false;
  if (isFunctionLike(symbol.initializer))
    return isAbsentPropertyEmptyRecordGroup(
      symbol.initializer,
      component.module.scopes,
      new Set(["value", "label"]),
    );
  const imported = getImportDeclarationForSymbol(symbol);
  if (
    !imported ||
    imported.importKind === "type" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type"
  )
    return false;
  const name = getImportedName(symbol.declarationNode);
  if (!name) return false;
  const resolved = resolveCrossFileValueExportWithFilePath(
    component.module.filename,
    String(imported.source.value),
    name,
  );
  if (
    !resolved ||
    resolveModulePath(component.module.filename, String(imported.source.value)) !==
      resolved.filePath
  )
    return false;
  const module = getModule(resolved.filePath, resolved.programNode);
  return (
    hasClosedModule(module) &&
    isAbsentPropertyEmptyRecordGroup(
      resolved.exportedNode,
      module.scopes,
      new Set(["value", "label"]),
    )
  );
};

const isEmptyGroupingCall = (expression: EsTreeNode, component: RadixDraftComponent): boolean => {
  if (!isNodeOfType(expression, "CallExpression")) return false;
  let call = expression;
  if (hasSupportedRadixReactCall(expression, "useMemo", component.module.scopes)) {
    const callback = expression.arguments[RADIX_DRAFT_FIRST_INDEX];
    const dependencies = expression.arguments[RADIX_DRAFT_SECOND_INDEX];
    if (
      expression.arguments.length !== RADIX_DRAFT_PAIR_COUNT ||
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      callback.async ||
      callback.params.length !== RADIX_DRAFT_EMPTY_COUNT ||
      !isNodeOfType(callback.body, "CallExpression") ||
      !isNodeOfType(dependencies, "ArrayExpression") ||
      dependencies.elements.length !== RADIX_DRAFT_SINGLE_COUNT ||
      callback.body.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
      !dependencies.elements[RADIX_DRAFT_FIRST_INDEX] ||
      !sameBinding(
        component.module,
        dependencies.elements[RADIX_DRAFT_FIRST_INDEX],
        callback.body.arguments[RADIX_DRAFT_FIRST_INDEX],
      )
    )
      return false;
    call = callback.body;
  }
  return Boolean(
    call.arguments[RADIX_DRAFT_FIRST_INDEX] &&
    isPlainOptionCollection(call.arguments[RADIX_DRAFT_FIRST_INDEX], component) &&
    isRecognizedGroupingCall(call, component),
  );
};

const hasOrdinaryRadixDeclaration = (filename: string): boolean => {
  const manifest = readNearestPackageManifest(filename);
  if (!manifest) return true;
  if (["overrides", "resolutions", "pnpm"].some((field) => field in manifest)) return false;
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ].every((dependencies) => {
    if (dependencies === undefined) return true;
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))
      return false;
    const declaration = dependencies[RADIX_DRAFT_MODULE_SOURCE];
    return (
      declaration === undefined ||
      (typeof declaration === "string" &&
        Boolean(parsePackageVersion(declaration.replace(/^[~^]/, ""))))
    );
  });
};

const hasClosedModule = (module: RadixDraftModule): boolean => {
  if (
    module.sourceText === undefined ||
    hasJsxRuntimePragma({
      program: module.program,
      filename: module.filename,
      sourceText: module.sourceText,
    }) ||
    !hasCurrentContextRecordEnvironment(module.filename) ||
    !hasOrdinaryRadixDeclaration(module.filename) ||
    resolveModulePath(module.filename, RADIX_DRAFT_MODULE_SOURCE)
  )
    return false;
  const cached = moduleFacts.get(module.scopes);
  if (cached?.sourceText === module.sourceText) return cached.valid;
  let valid = true;
  walkAst(module.program, (node) => {
    if (!valid) return false;
    if (
      RADIX_DRAFT_RUNTIME_TYPESCRIPT.has(node.type) ||
      isNodeOfType(node, "CatchClause") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "ThrowStatement")
    ) {
      valid = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      node.specifiers.length === RADIX_DRAFT_EMPTY_COUNT
    )
      valid = false;
    if (
      (isNodeOfType(node, "ExportAllDeclaration") ||
        isNodeOfType(node, "ExportNamedDeclaration")) &&
      node.source &&
      node.exportKind !== "type"
    )
      valid = false;
    if (
      isNodeOfType(node, "Property") &&
      (node.kind !== "init" ||
        node.method ||
        node.computed ||
        RADIX_DRAFT_FORBIDDEN_MEMBERS.has(getStaticPropertyKeyName(node) ?? ""))
    )
      valid = false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      (RADIX_DRAFT_FORBIDDEN_MEMBERS.has(
        getResolvedStaticPropertyName(node, module.scopes) ?? "",
      ) ||
        (node.computed &&
          ((isNodeOfType(node.parent, "CallExpression") && node.parent.callee === node) ||
            (isNodeOfType(node.parent, "VariableDeclarator") && node.parent.init === node))))
    )
      valid = false;
    if (
      isNodeOfType(node, "Identifier") &&
      !isNonReferenceIdentifier(node) &&
      ["Object", "Array", "String"].includes(node.name)
    ) {
      const member = node.parent;
      const invocation = member?.parent;
      const directString =
        node.name === "String" &&
        isNodeOfType(member, "CallExpression") &&
        member.callee === node &&
        !member.optional &&
        member.arguments.length === RADIX_DRAFT_SINGLE_COUNT;
      const passiveMember =
        isNodeOfType(member, "MemberExpression") &&
        member.object === node &&
        !member.computed &&
        !member.optional &&
        ((node.name === "Object" &&
          ["keys", "entries"].includes(getStaticPropertyKeyName(member) ?? "")) ||
          (node.name === "Array" && getStaticPropertyKeyName(member) === "from")) &&
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === member &&
        !invocation.optional;
      if (!module.scopes.isGlobalReference(node) || (!directString && !passiveMember))
        valid = false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      !isNonReferenceIdentifier(node) &&
      RADIX_DRAFT_FORBIDDEN_CAPABILITIES.has(node.name)
    )
      valid = false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.source.value === "react" &&
      node.importKind !== "type"
    ) {
      for (const specifier of node.specifiers) {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const symbol = module.scopes.symbolFor(specifier.local);
        if (!symbol || !readonlyBinding(module, symbol)) {
          valid = false;
          continue;
        }
        if (!isNodeOfType(specifier, "ImportSpecifier")) {
          if (symbol.references.length > RADIX_DRAFT_EMPTY_COUNT) valid = false;
          continue;
        }
        if (
          !symbol.references.every((reference) => {
            const parent = reference.identifier.parent;
            const importedName = getImportedName(specifier);
            if (
              (importedName === "Fragment" || importedName === "StrictMode") &&
              (isNodeOfType(parent, "JSXOpeningElement") ||
                isNodeOfType(parent, "JSXClosingElement")) &&
              parent.name === reference.identifier
            )
              return true;
            return (
              isNodeOfType(parent, "CallExpression") &&
              parent.callee === reference.identifier &&
              !parent.optional
            );
          })
        )
          valid = false;
      }
    }
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.source.value !== RADIX_DRAFT_MODULE_SOURCE ||
      node.importKind === "type"
    )
      return;
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const symbol = module.scopes.symbolFor(specifier.local);
      if (!readonlyBinding(module, symbol) || !symbol) {
        valid = false;
        continue;
      }
      for (const reference of symbol.references) {
        const parent = reference.identifier.parent;
        const member = isNodeOfType(specifier, "ImportNamespaceSpecifier")
          ? parent
          : reference.identifier;
        const opening = member?.parent;
        if (
          !member ||
          (!isNodeOfType(opening, "JSXOpeningElement") &&
            !isNodeOfType(opening, "JSXClosingElement"))
        ) {
          valid = false;
          continue;
        }
        if (
          isNodeOfType(specifier, "ImportNamespaceSpecifier") &&
          (!isNodeOfType(member, "JSXMemberExpression") || member.object !== reference.identifier)
        )
          valid = false;
      }
    }
  });
  moduleFacts.set(module.scopes, { sourceText: module.sourceText, valid });
  return valid;
};

const sdkElementName = (element: EsTreeNode, module: RadixDraftModule): string | null => {
  if (!isNodeOfType(element, "JSXElement")) return null;
  const tag = element.openingElement.name;
  const identifier = isNodeOfType(tag, "JSXMemberExpression") ? tag.object : tag;
  const symbol = module.scopes.symbolFor(identifier);
  const imported = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !imported ||
    imported.importKind === "type" ||
    imported.source.value !== RADIX_DRAFT_MODULE_SOURCE ||
    !readonlyBinding(module, symbol)
  )
    return null;
  if (
    isNodeOfType(tag, "JSXMemberExpression") &&
    isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") &&
    isNodeOfType(tag.property, "JSXIdentifier")
  )
    return tag.property.name;
  return isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    symbol.declarationNode.importKind !== "type"
    ? (getImportedName(symbol.declarationNode) ?? null)
    : null;
};

const resolveComponent = (
  element: EsTreeNode,
  parent: RadixDraftComponent,
  allowRecordProps = false,
  allowEventProps = false,
): RadixDraftComponent | null => {
  if (
    !isNodeOfType(element, "JSXElement") ||
    !isNodeOfType(element.openingElement.name, "JSXIdentifier") ||
    (!allowRecordProps &&
      element.openingElement.attributes.some((attribute) =>
        isNodeOfType(attribute, "JSXSpreadAttribute"),
      ))
  )
    return null;
  if (
    !allowRecordProps &&
    !allowEventProps &&
    element.openingElement.attributes.some((attribute) => {
      if (!isNodeOfType(attribute, "JSXAttribute")) return true;
      const name = getJsxAttributeName(attribute.name);
      if (!name || !RADIX_DRAFT_FORBIDDEN_ATTRIBUTES.has(name)) return false;
      const expression = attributeExpression(element, name);
      const value = expression && defaultValue(expression, parent);
      return !value || (value.kind !== "absent" && !(value.kind === "primitive" && !value.value));
    })
  )
    return null;
  const symbol = parent.module.scopes.symbolFor(element.openingElement.name);
  if (!readonlyBinding(parent.module, symbol) || !symbol) return null;
  if (isFunctionLike(symbol.initializer))
    return { module: parent.module, functionNode: symbol.initializer, instance: element, parent };
  const imported = getImportDeclarationForSymbol(symbol);
  if (
    !imported ||
    imported.importKind === "type" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type"
  )
    return null;
  const name = getImportedName(symbol.declarationNode);
  if (!name) return null;
  const resolved = resolveCrossFileValueExportWithFilePath(
    parent.module.filename,
    String(imported.source.value),
    name,
  );
  if (
    !resolved ||
    resolveModulePath(parent.module.filename, String(imported.source.value)) !== resolved.filePath
  )
    return null;
  const module = getModule(resolved.filePath, resolved.programNode);
  if (!hasClosedModule(module)) return null;
  return { module, functionNode: resolved.exportedNode, instance: element, parent };
};

const hasOnlyNativeFocusQueryResults = (query: EsTreeNode, module: RadixDraftModule): boolean => {
  const conversion = query.parent;
  if (
    !isNodeOfType(conversion, "CallExpression") ||
    conversion.optional ||
    conversion.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    conversion.arguments[RADIX_DRAFT_FIRST_INDEX] !== query ||
    !isNodeOfType(conversion.callee, "MemberExpression") ||
    conversion.callee.computed ||
    conversion.callee.optional ||
    getStaticPropertyKeyName(conversion.callee) !== "from" ||
    !isNodeOfType(conversion.callee.object, "Identifier") ||
    conversion.callee.object.name !== "Array" ||
    !module.scopes.isGlobalReference(conversion.callee.object)
  )
    return false;
  const root = findTransparentExpressionRoot(conversion);
  const declaration = root.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== root ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const"
  )
    return false;
  const items = module.scopes.symbolFor(declaration.id);
  return Boolean(
    items &&
    readonlyBinding(module, items) &&
    items.references.every((reference) => {
      const member = reference.identifier.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== reference.identifier ||
        isWithinAssignmentTarget(member)
      )
        return false;
      if (!member.computed && !member.optional && getStaticPropertyKeyName(member) === "length")
        return true;
      const focus = member.parent;
      const invocation = focus?.parent;
      return (
        member.computed &&
        !member.optional &&
        isNodeOfType(focus, "MemberExpression") &&
        focus.object === member &&
        !focus.computed &&
        getStaticPropertyKeyName(focus) === "focus" &&
        isNodeOfType(invocation, "CallExpression") &&
        invocation.callee === focus &&
        invocation.arguments.length === RADIX_DRAFT_EMPTY_COUNT
      );
    }),
  );
};

const hasOnlyNativeContainerReads = (symbol: SymbolDescriptor, module: RadixDraftModule): boolean =>
  readonlyBinding(module, symbol) &&
  symbol.references.every((reference) => {
    const parent = reference.identifier.parent;
    if (
      isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "!" &&
      isNodeOfType(parent.parent, "IfStatement") &&
      parent.parent.test === parent
    )
      return true;
    const call = parent?.parent;
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== reference.identifier ||
      parent.computed ||
      parent.optional ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== parent ||
      call.optional
    )
      return false;
    const method = getStaticPropertyKeyName(parent);
    const argument = call.arguments[RADIX_DRAFT_FIRST_INDEX];
    if (!isNodeOfType(argument, "Literal") || typeof argument.value !== "string") return false;
    if (method === "querySelectorAll")
      return (
        call.arguments.length === RADIX_DRAFT_SINGLE_COUNT &&
        hasOnlyNativeFocusQueryResults(call, module)
      );
    return (
      (method === "addEventListener" || method === "removeEventListener") &&
      call.arguments.length === RADIX_DRAFT_PAIR_COUNT &&
      argument.value === "keydown" &&
      isNodeOfType(call.arguments[RADIX_DRAFT_SECOND_INDEX], "Identifier") &&
      readonlyBinding(module, module.scopes.symbolFor(call.arguments[RADIX_DRAFT_SECOND_INDEX]))
    );
  });

const hasOwnNativeRef = (element: EsTreeNode, component: RadixDraftComponent): boolean => {
  if (
    !isNodeOfType(element, "JSXElement") ||
    !isNodeOfType(element.openingElement.name, "JSXIdentifier") ||
    element.openingElement.name.name !== "div"
  )
    return false;
  const reference = attributeExpression(element, "ref", true);
  const symbol = reference && component.module.scopes.symbolFor(reference);
  if (
    !isNodeOfType(reference, "Identifier") ||
    !symbol ||
    symbol.kind !== "const" ||
    !readonlyBinding(component.module, symbol) ||
    !isNodeOfType(symbol.initializer, "CallExpression") ||
    !hasSupportedRadixReactCall(symbol.initializer, "useRef", component.module.scopes) ||
    symbol.initializer.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(symbol.initializer.arguments[RADIX_DRAFT_FIRST_INDEX], "Literal") ||
    symbol.initializer.arguments[RADIX_DRAFT_FIRST_INDEX].value !== null
  )
    return false;
  return symbol.references.every((use) => {
    if (use.identifier === reference) return true;
    const member = use.identifier.parent;
    const declaration = member?.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== use.identifier ||
      member.computed ||
      member.optional ||
      getStaticPropertyKeyName(member) !== "current" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== member ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.kind !== "const"
    )
      return false;
    const alias = component.module.scopes.symbolFor(declaration.id);
    return Boolean(alias && hasOnlyNativeContainerReads(alias, component.module));
  });
};

const hasSafeAttributes = (element: EsTreeNode, component: RadixDraftComponent): boolean => {
  if (!isNodeOfType(element, "JSXElement")) return false;
  return element.openingElement.attributes.every((attribute) => {
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      const functionNode = component.functionNode;
      if (
        !isFunctionLike(functionNode) ||
        !isNodeOfType(functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern") ||
        !component.parent
      )
        return false;
      const rest = functionNode.params[RADIX_DRAFT_FIRST_INDEX].properties.find((property) =>
        isNodeOfType(property, "RestElement"),
      );
      if (
        !isNodeOfType(rest, "RestElement") ||
        !sameBinding(component.module, rest.argument, attribute.argument)
      )
        return false;
      const symbol = component.module.scopes.symbolFor(rest.argument);
      return Boolean(
        symbol &&
        readonlyBinding(component.module, symbol) &&
        symbol.references.length === RADIX_DRAFT_SINGLE_COUNT &&
        symbol.references[RADIX_DRAFT_FIRST_INDEX].identifier.parent === attribute &&
        component.instance.type === "JSXElement" &&
        component.instance.openingElement.attributes.every((supplied) => {
          if (!isNodeOfType(supplied, "JSXAttribute")) return false;
          const name = getJsxAttributeName(supplied.name);
          if (!name || name.startsWith("on")) return false;
          if (propertyBinding(component, name)) return true;
          if (!RADIX_DRAFT_FORBIDDEN_ATTRIBUTES.has(name)) return true;
          const expression = attributeExpression(component.instance, name);
          const value =
            expression && component.parent && defaultValue(expression, component.parent);
          return Boolean(
            value && (value.kind === "absent" || (value.kind === "primitive" && !value.value)),
          );
        }),
      );
    }
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    if (!name || name.startsWith("on")) return false;
    if (name === "is") return false;
    if (name === "ref") return hasOwnNativeRef(element, component);
    if (name === "style") {
      const value = attributeExpression(element, name);
      return Boolean(
        isNodeOfType(value, "ObjectExpression") &&
        value.properties.every(
          (property) =>
            isNodeOfType(property, "Property") &&
            !property.computed &&
            !property.method &&
            property.kind === "init" &&
            getStaticPropertyKeyName(property) === "zIndex" &&
            isNodeOfType(property.value, "Literal") &&
            typeof property.value.value === "number",
        ),
      );
    }
    if (!RADIX_DRAFT_FORBIDDEN_ATTRIBUTES.has(name)) return true;
    const expression = attributeExpression(element, name);
    if (!expression) return true;
    const value = defaultValue(expression, component);
    return value.kind === "absent" || (value.kind === "primitive" && !value.value);
  });
};

const isMountedRenderPath = (
  node: EsTreeNode,
  root: EsTreeNode,
  component: RadixDraftComponent,
  requireNativeAncestors = false,
  projection = false,
): boolean => {
  let child = node;
  while (child !== root) {
    const parent = child.parent;
    if (
      !parent ||
      isFunctionLike(parent) ||
      isNodeOfType(parent, "CallExpression") ||
      isNodeOfType(parent, "JSXAttribute") ||
      isNodeOfType(parent, "ObjectExpression") ||
      isNodeOfType(parent, "ArrayExpression") ||
      isNodeOfType(parent, "Property")
    )
      return false;
    if (isNodeOfType(parent, "ConditionalExpression")) {
      const value = defaultValue(parent.test, component);
      if (value.kind !== "primitive" && value.kind !== "absent") return false;
      const chosen =
        value.kind === "primitive" && value.value ? parent.consequent : parent.alternate;
      if (chosen !== child) return false;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      if (parent.right !== child) return false;
      const value = defaultValue(parent.left, component);
      if (value.kind !== "primitive" && value.kind !== "absent") return false;
      const truthy = value.kind === "primitive" && Boolean(value.value);
      if (
        parent.operator === "&&"
          ? !truthy
          : parent.operator === "||"
            ? truthy
            : value.kind !== "absent" && value.value !== null
      )
        return false;
    }
    if (requireNativeAncestors && isNodeOfType(parent, "JSXElement")) {
      const tag = parent.openingElement.name;
      const sdkName = sdkElementName(parent, component.module);
      if (
        sdkName !== "Root" &&
        sdkName !== "Content" &&
        !(projection && parent === root && sdkName === "Item") &&
        (!isNodeOfType(tag, "JSXIdentifier") ||
          !(tag.name === "div" || (projection && tag.name === "span")) ||
          !hasSafeAttributes(parent, component))
      )
        return false;
    }
    child = parent;
  }
  return true;
};

const directChildrenTarget = (component: RadixDraftComponent): EsTreeNode | null => {
  const functionNode = component.functionNode;
  const children = propertyBinding(component, "children");
  if (!children || !isNodeOfType(children, "Identifier")) return null;
  const symbol = component.module.scopes.symbolFor(children);
  const root = returnedElement(functionNode);
  if (!root || !readonlyBinding(component.module, symbol) || !symbol) return null;
  let target: EsTreeNode | null = null;
  for (const reference of symbol.references) {
    const expression = reference.identifier.parent;
    if (isNodeOfType(expression, "ArrayExpression")) {
      const hook = expression.parent;
      if (
        isNodeOfType(hook, "CallExpression") &&
        hook.arguments[RADIX_DRAFT_SECOND_INDEX] === expression &&
        ["useEffect", "useMemo", "useCallback"].some((name) =>
          hasSupportedRadixReactCall(hook, name, component.module.scopes),
        )
      )
        continue;
    }
    if (
      !isNodeOfType(expression, "JSXExpressionContainer") ||
      expression.expression !== reference.identifier ||
      !isNodeOfType(expression.parent, "JSXElement") ||
      !isMountedRenderPath(expression.parent, root, component, true) ||
      target
    )
      return null;
    target = expression.parent;
  }
  return target;
};

const isDeferredNativeButtonCall = (call: EsTreeNode, component: RadixDraftComponent): boolean => {
  const callback = findEnclosingFunction(call);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    !(
      callback.body === call ||
      (isNodeOfType(callback.body, "BlockStatement") &&
        callback.body.body.length === RADIX_DRAFT_SINGLE_COUNT &&
        isNodeOfType(callback.body.body[RADIX_DRAFT_FIRST_INDEX], "ExpressionStatement") &&
        callback.body.body[RADIX_DRAFT_FIRST_INDEX].expression === call)
    )
  )
    return false;
  const expression = callback.parent;
  const attribute = expression?.parent;
  const opening = attribute?.parent;
  const element = opening?.parent;
  if (
    !isNodeOfType(expression, "JSXExpressionContainer") ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    getJsxAttributeName(attribute.name) !== "onClick" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(element, "JSXElement")
  )
    return false;
  if (isNodeOfType(opening.name, "JSXIdentifier") && opening.name.name === "button") return true;
  const bridge = resolveComponent(element, component, false, true);
  if (
    !bridge ||
    !isFunctionLike(bridge.functionNode) ||
    !isNodeOfType(bridge.functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern")
  )
    return false;
  const properties = bridge.functionNode.params[RADIX_DRAFT_FIRST_INDEX].properties;
  if (
    properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        ["onClick", "ref", "asChild"].includes(getStaticPropertyKeyName(property) ?? ""),
    )
  )
    return false;
  const root = returnedElement(bridge.functionNode);
  const rest = properties.find((property) => isNodeOfType(property, "RestElement"));
  if (
    !root ||
    !isNodeOfType(root, "JSXElement") ||
    !isNodeOfType(root.openingElement.name, "JSXIdentifier") ||
    root.openingElement.name.name !== "button" ||
    !isNodeOfType(rest, "RestElement")
  )
    return false;
  const symbol = bridge.module.scopes.symbolFor(rest.argument);
  const spread = root.openingElement.attributes.at(RADIX_DRAFT_LAST_INDEX);
  return Boolean(
    symbol &&
    readonlyBinding(bridge.module, symbol) &&
    symbol.references.length === RADIX_DRAFT_SINGLE_COUNT &&
    isNodeOfType(spread, "JSXSpreadAttribute") &&
    symbol.references[RADIX_DRAFT_FIRST_INDEX].identifier.parent === spread &&
    root.openingElement.attributes.every(
      (entry) =>
        entry === spread ||
        (isNodeOfType(entry, "JSXAttribute") &&
          !["onClick", "ref", "is", "asChild"].includes(getJsxAttributeName(entry.name) ?? "")),
    ) &&
    opening.attributes.every(
      (entry) =>
        isNodeOfType(entry, "JSXAttribute") &&
        (!(getJsxAttributeName(entry.name) ?? "").startsWith("on") || entry === attribute) &&
        !["ref", "is", "asChild"].includes(getJsxAttributeName(entry.name) ?? ""),
    ),
  );
};

const hasClosedOpeningSetter = (
  setter: SymbolDescriptor,
  forwarded: EsTreeNode,
  component: RadixDraftComponent,
): boolean =>
  setter.references.every((reference) => {
    if (reference.identifier === forwarded) return true;
    const call = reference.identifier.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== reference.identifier ||
      call.optional ||
      call.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
      !isNodeOfType(call.arguments[RADIX_DRAFT_FIRST_INDEX], "Literal") ||
      typeof call.arguments[RADIX_DRAFT_FIRST_INDEX].value !== "boolean"
    )
      return false;
    if (isDeferredNativeButtonCall(call, component)) return true;
    const owner = findEnclosingFunction(call);
    if (
      !owner ||
      !isFunctionLike(owner) ||
      owner.async ||
      owner.generator ||
      findEnclosingFunction(owner) !== component.functionNode
    )
      return false;
    const binding = getFunctionBindingIdentifier(owner);
    const symbol = binding && component.module.scopes.symbolFor(binding);
    return Boolean(
      symbol &&
      symbol.kind === "const" &&
      readonlyBinding(component.module, symbol) &&
      symbol.references.length > RADIX_DRAFT_EMPTY_COUNT &&
      symbol.references.every((use) => {
        const invocation = use.identifier.parent;
        return (
          isNodeOfType(invocation, "CallExpression") &&
          invocation.callee === use.identifier &&
          !invocation.optional &&
          isDeferredNativeButtonCall(invocation, component)
        );
      }),
    );
  });

const knownOpenState = (root: EsTreeNode, component: RadixDraftComponent): boolean => {
  const open = attributeExpression(root, "open");
  if (!open) return true;
  const mode = defaultValue(open, component);
  if (mode.kind === "primitive") return mode.value === true;
  if (!component.parent || !isNodeOfType(open, "Identifier")) return false;
  const functionNode = component.functionNode;
  if (
    !isFunctionLike(functionNode) ||
    !isNodeOfType(functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern")
  )
    return false;
  const property = functionNode.params[RADIX_DRAFT_FIRST_INDEX].properties.find(
    (candidate) =>
      isNodeOfType(candidate, "Property") && sameBinding(component.module, candidate.value, open),
  );
  const name = property && getStaticPropertyKeyName(property);
  const supplied = name && attributeExpression(component.instance, name);
  if (!supplied || !isNodeOfType(supplied, "Identifier")) return false;
  const state = component.parent.module.scopes.symbolFor(supplied);
  const declaration = state?.declarationNode;
  if (
    !state ||
    !readonlyBinding(component.parent.module, state) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !hasSupportedRadixReactCall(declaration.init, "useState", component.parent.module.scopes)
  )
    return false;
  const setter = declaration.id.elements[RADIX_DRAFT_SECOND_INDEX];
  const setterSymbol = setter && component.parent.module.scopes.symbolFor(setter);
  if (
    !setterSymbol ||
    !readonlyBinding(component.parent.module, setterSymbol) ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    declaration.id.elements.length !== RADIX_DRAFT_PAIR_COUNT ||
    declaration.init.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(declaration.init.arguments[RADIX_DRAFT_FIRST_INDEX], "Literal") ||
    typeof declaration.init.arguments[RADIX_DRAFT_FIRST_INDEX].value !== "boolean"
  )
    return false;
  const change = attributeExpression(component.instance, "onOpenChange");
  const forwardedChange = attributeExpression(root, "onOpenChange");
  const changeBinding = propertyBinding(component, "onOpenChange");
  const changeSymbol = changeBinding && component.module.scopes.symbolFor(changeBinding);
  return Boolean(
    setter &&
    change &&
    sameBinding(component.parent.module, setter, change) &&
    changeSymbol &&
    readonlyBinding(component.module, changeSymbol) &&
    changeSymbol.references.every((reference) => reference.identifier === forwardedChange) &&
    hasClosedOpeningSetter(setterSymbol, change, component.parent) &&
    forwardedChange &&
    changeBinding &&
    sameBinding(component.module, forwardedChange, changeBinding),
  );
};

const defaultTriggerElement = (component: RadixDraftComponent): EsTreeNode | null => {
  let functionNode = component.functionNode;
  if (isNodeOfType(functionNode, "CallExpression")) {
    if (
      !hasSupportedRadixReactCall(functionNode, "forwardRef", component.module.scopes) ||
      functionNode.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
      !isFunctionLike(functionNode.arguments[RADIX_DRAFT_FIRST_INDEX])
    )
      return null;
    functionNode = functionNode.arguments[RADIX_DRAFT_FIRST_INDEX];
  }
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator ||
    functionNode.params.length !== RADIX_DRAFT_PAIR_COUNT ||
    !isNodeOfType(functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern") ||
    !isNodeOfType(functionNode.params[RADIX_DRAFT_SECOND_INDEX], "Identifier") ||
    !isNodeOfType(functionNode.body, "BlockStatement")
  )
    return null;
  const view: RadixDraftComponent = { ...component, functionNode: functionNode };
  const inactiveStatements: EsTreeNode[] = [];
  for (const statement of functionNode.body.body) {
    if (isNodeOfType(statement, "IfStatement")) {
      if (
        statement.alternate ||
        !isNodeOfType(statement.test, "BinaryExpression") ||
        statement.test.operator !== "===" ||
        !isNodeOfType(statement.test.right, "Literal")
      )
        return null;
      const value = defaultValue(statement.test.left, view);
      if (value.kind !== "primitive" || value.value === statement.test.right.value) return null;
      inactiveStatements.push(statement.consequent);
      continue;
    }
    if (isNodeOfType(statement, "ThrowStatement")) return null;
    if (
      !isNodeOfType(statement, "VariableDeclaration") &&
      !isNodeOfType(statement, "ReturnStatement")
    )
      return null;
    if (
      isNodeOfType(statement, "ReturnStatement") &&
      statement !== functionNode.body.body.at(RADIX_DRAFT_LAST_INDEX)
    )
      return null;
    if (
      isNodeOfType(statement, "VariableDeclaration") &&
      (statement.kind !== "const" ||
        statement.declarations.some(
          (declaration) =>
            !declaration.init ||
            isNodeOfType(stripParenExpression(declaration.init), "CallExpression"),
        ))
    )
      return null;
  }
  const returned = functionNode.body.body.at(RADIX_DRAFT_LAST_INDEX);
  if (!isNodeOfType(returned, "ReturnStatement") || !returned.argument) return null;
  const root = stripParenExpression(returned.argument);
  if (
    !isNodeOfType(root, "JSXElement") ||
    !isNodeOfType(root.openingElement.name, "JSXIdentifier") ||
    root.openingElement.name.name !== "button"
  )
    return null;
  const ref = attributeExpression(root, "ref", true);
  const rest = functionNode.params[RADIX_DRAFT_FIRST_INDEX].properties.find((property) =>
    isNodeOfType(property, "RestElement"),
  );
  if (
    !ref ||
    !sameBinding(component.module, ref, functionNode.params[RADIX_DRAFT_SECOND_INDEX]) ||
    !isNodeOfType(rest, "RestElement") ||
    !isNodeOfType(rest.argument, "Identifier")
  )
    return null;
  const forwarded = component.module.scopes.symbolFor(rest.argument);
  if (!readonlyBinding(component.module, forwarded) || !forwarded) return null;
  const spread = root.openingElement.attributes.at(RADIX_DRAFT_LAST_INDEX);
  if (
    !isNodeOfType(spread, "JSXSpreadAttribute") ||
    !sameBinding(component.module, spread.argument, rest.argument)
  )
    return null;
  if (
    !forwarded.references.every(
      (reference) =>
        reference.identifier.parent === spread ||
        inactiveStatements.some((statement) => isAstDescendant(reference.identifier, statement)),
    )
  )
    return null;
  if (
    root.openingElement.attributes.some(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        (getJsxAttributeName(attribute.name) ?? "").startsWith("on"),
    )
  )
    return null;
  for (const attribute of component.instance.type === "JSXElement"
    ? component.instance.openingElement.attributes
    : []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return null;
    const name = getJsxAttributeName(attribute.name);
    if (
      !name ||
      ["ref", "asChild", "onClick", "onPointerDown", "onMouseDown", "onKeyDown"].includes(name)
    )
      return null;
    if (RADIX_DRAFT_FORBIDDEN_ATTRIBUTES.has(name)) {
      const value = attributeExpression(component.instance, name);
      const mode = value && component.parent && defaultValue(value, component.parent);
      if (!mode || (mode.kind !== "absent" && !(mode.kind === "primitive" && !mode.value)))
        return null;
    }
    if (name.startsWith("on") && !propertyBinding(view, name)) return null;
  }
  if (
    !readonlyBinding(
      component.module,
      component.module.scopes.symbolFor(functionNode.params[RADIX_DRAFT_SECOND_INDEX]),
    )
  )
    return null;
  return root;
};

const selectedTriggerChild = (
  trigger: EsTreeNode,
  component: RadixDraftComponent,
): EsTreeNode | null => {
  if (!isNodeOfType(trigger, "JSXElement")) return null;
  const children = trigger.children.filter(
    (child) =>
      !isNodeOfType(child, "JSXText") || child.value.trim().length > RADIX_DRAFT_EMPTY_COUNT,
  );
  if (children.length !== RADIX_DRAFT_SINGLE_COUNT) return null;
  const child = children[RADIX_DRAFT_FIRST_INDEX];
  if (isNodeOfType(child, "JSXElement")) return child;
  if (
    !isNodeOfType(child, "JSXExpressionContainer") ||
    !isNodeOfType(child.expression, "Identifier") ||
    !component.parent
  )
    return null;
  const functionNode = component.functionNode;
  if (
    !isFunctionLike(functionNode) ||
    !isNodeOfType(functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern")
  )
    return null;
  const property = functionNode.params[RADIX_DRAFT_FIRST_INDEX].properties.find(
    (candidate) =>
      isNodeOfType(candidate, "Property") &&
      sameBinding(component.module, candidate.value, child.expression),
  );
  const name = property && getStaticPropertyKeyName(property);
  let supplied = name && attributeExpression(component.instance, name);
  if (isNodeOfType(supplied, "LogicalExpression") && supplied.operator === "??") {
    const left = defaultValue(supplied.left, component.parent);
    if (left.kind !== "absent" && !(left.kind === "primitive" && left.value === null)) return null;
    supplied = stripParenExpression(supplied.right);
  }
  return isNodeOfType(supplied, "JSXElement") ? supplied : null;
};

const hasSupportedTrigger = (trigger: EsTreeNode, component: RadixDraftComponent): boolean => {
  if (!isNodeOfType(trigger, "JSXElement")) return false;
  for (const attribute of trigger.openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) return false;
    const name = getJsxAttributeName(attribute.name);
    if (!name || name.startsWith("on") || name === "ref" || name === "is") return false;
    if (name !== "asChild" && RADIX_DRAFT_FORBIDDEN_ATTRIBUTES.has(name)) {
      const expression = attributeExpression(trigger, name);
      const value = expression && defaultValue(expression, component);
      if (value && value.kind !== "absent" && !(value.kind === "primitive" && !value.value))
        return false;
    }
  }
  const asChild = attributeExpression(trigger, "asChild");
  if (!asChild) return true;
  if (
    !isNodeOfType(asChild, "JSXAttribute") &&
    !(isNodeOfType(asChild, "Literal") && asChild.value === true)
  )
    return false;
  const supplied = selectedTriggerChild(trigger, component);
  if (!supplied || !component.parent) return false;
  const bridge = resolveComponent(supplied, component.parent);
  return Boolean(bridge && defaultTriggerElement(bridge));
};

const hasMenuContext = (target: EsTreeNode, component: RadixDraftComponent): boolean => {
  const root = returnedElement(component.functionNode);
  if (
    !root ||
    sdkElementName(target, component.module) !== "Content" ||
    !hasSafeAttributes(target, component) ||
    !isMountedRenderPath(target, root, component, true)
  )
    return false;
  let ancestor = target.parent;
  while (ancestor && ancestor !== component.functionNode) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      sdkElementName(ancestor, component.module) === "Root"
    ) {
      if (
        !knownOpenState(ancestor, component) ||
        ancestor.openingElement.attributes.some((attribute) => {
          if (!isNodeOfType(attribute, "JSXAttribute")) return true;
          const name = getJsxAttributeName(attribute.name);
          if (name === "open" || name === "onOpenChange" || name === "modal") return false;
          return !name || name.startsWith("on") || RADIX_DRAFT_FORBIDDEN_ATTRIBUTES.has(name);
        })
      )
        return false;
      return ancestor.children.some(
        (child) =>
          isNodeOfType(child, "JSXElement") &&
          sdkElementName(child, component.module) === "Trigger" &&
          hasSupportedTrigger(child, component),
      );
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const renderedMapHasMenu = (map: EsTreeNode, component: RadixDraftComponent): boolean => {
  const root = returnedElement(component.functionNode);
  if (!root || !isAstDescendant(map, root)) return false;
  let bridgeCount = RADIX_DRAFT_EMPTY_COUNT;
  let child = map;
  let parent = child.parent;
  while (parent && parent !== component.functionNode) {
    if (isFunctionLike(parent)) return false;
    if (isNodeOfType(parent, "ConditionalExpression")) {
      const value = defaultValue(parent.test, component);
      if (value.kind !== "primitive" && value.kind !== "absent") return false;
      const chosen =
        value.kind === "primitive" && value.value ? parent.consequent : parent.alternate;
      if (chosen !== child) return false;
    } else if (
      isNodeOfType(parent, "LogicalExpression") ||
      isNodeOfType(parent, "CallExpression") ||
      isNodeOfType(parent, "JSXAttribute")
    )
      return false;
    if (isNodeOfType(parent, "JSXElement")) {
      const tag = parent.openingElement.name;
      if (isNodeOfType(tag, "JSXIdentifier") && /^[a-z]/.test(tag.name)) {
        if (tag.name !== "div" || !hasSafeAttributes(parent, component)) return false;
      } else {
        if (hasMenuContext(parent, component))
          return isMountedRenderPath(parent, root, component, true);
        bridgeCount += RADIX_DRAFT_SINGLE_COUNT;
        if (bridgeCount > RADIX_DRAFT_MAX_BRIDGE_COUNT) return false;
        const bridge = resolveComponent(parent, component);
        if (!bridge) return false;
        const target = directChildrenTarget(bridge);
        if (!target) return false;
        if (hasMenuContext(target, bridge))
          return isMountedRenderPath(parent, root, component, true);
        if (
          !isNodeOfType(target, "JSXElement") ||
          !isNodeOfType(target.openingElement.name, "JSXIdentifier") ||
          target.openingElement.name.name !== "div" ||
          !hasSafeAttributes(target, bridge)
        )
          return false;
      }
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
};

const resolveItem = (item: EsTreeNode, component: RadixDraftComponent): boolean => {
  if (sdkElementName(item, component.module) === "Item") return true;
  const bridge = resolveComponent(item, component, true);
  if (
    !bridge ||
    !isFunctionLike(bridge.functionNode) ||
    !isNodeOfType(bridge.functionNode.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern")
  )
    return false;
  const root = returnedElement(bridge.functionNode);
  if (!isNodeOfType(root, "JSXElement") || sdkElementName(root, bridge.module) !== "Item")
    return false;
  const props = bridge.functionNode.params[RADIX_DRAFT_FIRST_INDEX];
  if (
    props.properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        ["onSelect", "onClick", "asChild"].includes(getStaticPropertyKeyName(property) ?? ""),
    )
  )
    return false;
  const rest = props.properties.find((property) => isNodeOfType(property, "RestElement"));
  if (!isNodeOfType(rest, "RestElement") || !isNodeOfType(rest.argument, "Identifier"))
    return false;
  const symbol = bridge.module.scopes.symbolFor(rest.argument);
  if (
    !readonlyBinding(bridge.module, symbol) ||
    !symbol ||
    symbol.references.length !== RADIX_DRAFT_SINGLE_COUNT
  )
    return false;
  const spread = symbol.references[RADIX_DRAFT_FIRST_INDEX].identifier.parent;
  return Boolean(
    isNodeOfType(spread, "JSXSpreadAttribute") &&
    root.openingElement.attributes.at(RADIX_DRAFT_LAST_INDEX) === spread &&
    root.openingElement.attributes.every(
      (attribute) =>
        attribute === spread ||
        (isNodeOfType(attribute, "JSXAttribute") &&
          !(getJsxAttributeName(attribute.name) ?? "").startsWith("on") &&
          !RADIX_DRAFT_FORBIDDEN_ATTRIBUTES.has(getJsxAttributeName(attribute.name) ?? "")),
    ),
  );
};

const isSelectedChoiceProjection = (
  expression: EsTreeNode,
  state: EsTreeNode,
  optionValue: EsTreeNode,
  module: RadixDraftModule,
): boolean => {
  const conditional = stripParenExpression(expression);
  if (!isNodeOfType(conditional, "ConditionalExpression")) return false;
  let test = conditional.test;
  if (isNodeOfType(test, "LogicalExpression") && test.operator === "&&") {
    const guard = test.left;
    if (
      !isNodeOfType(guard, "BinaryExpression") ||
      guard.operator !== "!==" ||
      !sameBinding(module, guard.left, optionValue) ||
      !isNodeOfType(guard.right, "Identifier") ||
      guard.right.name !== "undefined" ||
      !module.scopes.isGlobalReference(guard.right)
    )
      return false;
    test = test.right;
  }
  if (
    !isNodeOfType(test, "CallExpression") ||
    test.optional ||
    test.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !sameBinding(module, test.arguments[RADIX_DRAFT_FIRST_INDEX], optionValue) ||
    !isNodeOfType(test.callee, "MemberExpression") ||
    test.callee.computed ||
    test.callee.optional ||
    getStaticPropertyKeyName(test.callee) !== "includes" ||
    !sameBinding(module, test.callee.object, state)
  )
    return false;
  const branches = [conditional.consequent, conditional.alternate].map((branch) =>
    stripParenExpression(branch),
  );
  if (
    branches.every(
      (branch) =>
        isNodeOfType(branch, "Literal") &&
        (typeof branch.value === "string" || typeof branch.value === "number"),
    )
  )
    return (
      isNodeOfType(conditional.consequent, "Literal") &&
      isNodeOfType(conditional.alternate, "Literal") &&
      conditional.consequent.value !== conditional.alternate.value
    );
  const tags = branches.map((branch) =>
    isNodeOfType(branch, "JSXElement") &&
    isNodeOfType(branch.openingElement.name, "JSXIdentifier") &&
    branch.openingElement.attributes.length === RADIX_DRAFT_EMPTY_COUNT &&
    branch.children.length === RADIX_DRAFT_EMPTY_COUNT
      ? branch.openingElement.name.name
      : null,
  );
  return Boolean(
    tags[RADIX_DRAFT_FIRST_INDEX] &&
    tags[RADIX_DRAFT_SECOND_INDEX] &&
    tags[RADIX_DRAFT_FIRST_INDEX] !== tags[RADIX_DRAFT_SECOND_INDEX],
  );
};

export const hasSupportedRadixDraftEventCall = (
  call: EsTreeNode,
  componentFunction: EsTreeNode,
  context: Pick<RuleContext, "filename" | "scopes" | "sourceCode">,
  copiedSource?: EsTreeNode,
  selectedState?: EsTreeNode,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isFunctionLike(componentFunction) ||
    !isNodeOfType(componentFunction.params[RADIX_DRAFT_FIRST_INDEX], "ObjectPattern") ||
    !context.filename ||
    !isExportedComponent(componentFunction)
  )
    return false;
  const program = findProgramRoot(call);
  if (!program) return false;
  const module: RadixDraftModule = {
    filename: context.filename,
    program,
    scopes: context.scopes,
    sourceText: context.sourceCode?.getText?.(),
  };
  const callback = call.parent;
  const property = callback?.parent;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.body !== call ||
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.method ||
    property.kind !== "init" ||
    getStaticPropertyKeyName(property) !== "onSelect" ||
    property.value !== callback ||
    !isNodeOfType(property.parent, "ObjectExpression")
  )
    return false;
  const recordExpression = property.parent;
  const declaration = findTransparentExpressionRoot(recordExpression).parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const"
  )
    return false;
  const record = module.scopes.symbolFor(declaration.id);
  const mapper = findEnclosingFunction(declaration);
  if (
    !readonlyBinding(module, record) ||
    !record ||
    record.references.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !mapper ||
    !isFunctionLike(mapper) ||
    mapper.params.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(mapper.params[RADIX_DRAFT_FIRST_INDEX], "Identifier") ||
    !isNodeOfType(mapper.body, "BlockStatement") ||
    mapper.body.body.length !== RADIX_DRAFT_THREE_STATEMENTS_COUNT
  )
    return false;
  const projection = mapper.body.body[RADIX_DRAFT_FIRST_INDEX];
  if (
    !isNodeOfType(projection, "VariableDeclaration") ||
    projection.kind !== "const" ||
    projection.declarations.length !== RADIX_DRAFT_SINGLE_COUNT
  )
    return false;
  const option = projection.declarations[RADIX_DRAFT_FIRST_INDEX];
  if (
    !isNodeOfType(option.id, "ObjectPattern") ||
    !option.init ||
    !sameBinding(module, option.init, mapper.params[RADIX_DRAFT_FIRST_INDEX])
  )
    return false;
  const value = option.id.properties.find(
    (candidate) =>
      isNodeOfType(candidate, "Property") && getStaticPropertyKeyName(candidate) === "value",
  );
  const rest = option.id.properties.find((candidate) => isNodeOfType(candidate, "RestElement"));
  if (
    !isNodeOfType(value, "Property") ||
    !isNodeOfType(value.value, "Identifier") ||
    !isNodeOfType(rest, "RestElement") ||
    !isNodeOfType(rest.argument, "Identifier")
  )
    return false;
  const optionValue = module.scopes.symbolFor(value.value);
  const optionRest = module.scopes.symbolFor(rest.argument);
  if (
    !optionValue ||
    !optionRest ||
    !readonlyBinding(module, optionValue) ||
    !readonlyBinding(module, optionRest)
  )
    return false;
  const optionSymbol = module.scopes.symbolFor(mapper.params[RADIX_DRAFT_FIRST_INDEX]);
  if (
    !optionSymbol ||
    !readonlyBinding(module, optionSymbol) ||
    !optionSymbol.references.every((reference) => reference.identifier === option.init) ||
    !optionRest.references.every(
      (reference) =>
        isNodeOfType(reference.identifier.parent, "SpreadElement") &&
        reference.identifier.parent.parent === recordExpression,
    )
  )
    return false;
  if (
    callback.params.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(callback.params[RADIX_DRAFT_FIRST_INDEX], "Identifier") ||
    call.arguments.length !== RADIX_DRAFT_PAIR_COUNT ||
    !sameBinding(
      module,
      call.arguments[RADIX_DRAFT_FIRST_INDEX],
      callback.params[RADIX_DRAFT_FIRST_INDEX],
    ) ||
    !sameBinding(module, call.arguments[RADIX_DRAFT_SECOND_INDEX], value.value)
  )
    return false;
  if (
    !recordExpression.properties.every((candidate) => {
      if (candidate === property) return true;
      if (isNodeOfType(candidate, "SpreadElement"))
        return sameBinding(module, candidate.argument, rest.argument);
      return (
        isNodeOfType(candidate, "Property") &&
        !candidate.computed &&
        !candidate.method &&
        candidate.kind === "init" &&
        (getStaticPropertyKeyName(candidate) === "children" ||
          !RADIX_DRAFT_FORBIDDEN_ATTRIBUTES.has(getStaticPropertyKeyName(candidate) ?? ""))
      );
    })
  )
    return false;
  if (!hasClosedModule(module)) return false;
  const spread = record.references[RADIX_DRAFT_FIRST_INDEX].identifier.parent;
  const opening = spread?.parent;
  const item = opening?.parent;
  if (
    !isNodeOfType(spread, "JSXSpreadAttribute") ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    opening.attributes.length !== RADIX_DRAFT_SINGLE_COUNT ||
    !isNodeOfType(item, "JSXElement") ||
    returnedElement(mapper) !== item
  )
    return false;
  const mapperIdentifier = getFunctionBindingIdentifier(mapper);
  if (!mapperIdentifier) return false;
  const component: RadixDraftComponent = {
    module,
    functionNode: componentFunction,
    instance: item,
    copiedSource,
    mapper: mapperIdentifier,
  };
  if (!resolveItem(item, component)) return false;
  if (selectedState) {
    const renderedProperties = recordExpression.properties.filter((candidate) => {
      if (
        !isNodeOfType(candidate, "Property") ||
        candidate === property ||
        candidate.computed ||
        !getStaticPropertyKeyName(candidate)
      )
        return false;
      return isSelectedChoiceProjection(candidate.value, selectedState, value.value, module);
    });
    if (renderedProperties.length === RADIX_DRAFT_EMPTY_COUNT) return false;
    if (
      sdkElementName(item, module) === "Item" &&
      !renderedProperties.some((candidate) => getStaticPropertyKeyName(candidate) === "children")
    )
      return false;
    if (sdkElementName(item, module) !== "Item") {
      const bridge = resolveComponent(item, component, true);
      if (!bridge) return false;
      const root = returnedElement(bridge.functionNode);
      if (
        !root ||
        !renderedProperties.some((candidate) => {
          const name = getStaticPropertyKeyName(candidate);
          const binding = name && propertyBinding(bridge, name);
          if (!isNodeOfType(binding, "Identifier")) return false;
          const symbol = bridge.module.scopes.symbolFor(binding);
          return Boolean(
            symbol &&
            readonlyBinding(bridge.module, symbol) &&
            symbol.references.some(
              (reference) =>
                isNodeOfType(reference.identifier.parent, "JSXExpressionContainer") &&
                reference.identifier.parent.expression === reference.identifier &&
                isNodeOfType(reference.identifier.parent.parent, "JSXElement") &&
                (reference.identifier.parent.parent === root ||
                  (isNodeOfType(
                    reference.identifier.parent.parent.openingElement.name,
                    "JSXIdentifier",
                  ) &&
                    ["div", "span"].includes(
                      reference.identifier.parent.parent.openingElement.name.name,
                    ) &&
                    hasSafeAttributes(reference.identifier.parent.parent, bridge))) &&
                isMountedRenderPath(reference.identifier.parent.parent, root, bridge, true, true),
            ),
          );
        })
      )
        return false;
    }
  }
  const mapperSymbol = module.scopes.symbolFor(mapperIdentifier);
  if (!readonlyBinding(module, mapperSymbol) || !mapperSymbol) return false;
  let positive = false;
  for (const reference of mapperSymbol.references) {
    const invocation = reference.identifier.parent;
    if (
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.optional ||
      invocation.arguments.length !== RADIX_DRAFT_SINGLE_COUNT ||
      invocation.arguments[RADIX_DRAFT_FIRST_INDEX] !== reference.identifier ||
      !isNodeOfType(invocation.callee, "MemberExpression") ||
      invocation.callee.computed ||
      getStaticPropertyKeyName(invocation.callee) !== "map"
    )
      return false;
    if (
      isPlainOptionCollection(invocation.callee.object, component) &&
      renderedMapHasMenu(invocation, component)
    ) {
      positive = true;
      continue;
    }
    if (!isInactiveDefaultBranch(invocation, component)) return false;
  }
  return positive;
};
