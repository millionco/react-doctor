import { createErasedDefaultExportCertificate } from "./create-erased-default-export-certificate.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex } from "../build-source-project-index.js";
import { findExportedValue } from "../find-exported-value.js";
import { getImportedName } from "../get-imported-name.js";
import { isTypeOnlyImport } from "../is-type-only-import.js";
import { walkAst } from "../walk-ast.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { findEnclosingFunction } from "../find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../get-direct-const-initializer.js";
import { getStaticPropertyName } from "../get-static-property-name.js";
import { isComponentFunction } from "../is-component-function.js";
import { isFunctionLike } from "../is-function-like.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isWithinAssignmentTarget } from "../is-within-assignment-target.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { isSupportedNativeDelayWriter } from "./is-supported-native-delay-writer.js";
import { isSupportedRuntimeScopeNode } from "./is-supported-runtime-scope-node.js";
import { isClosedReactHookCall } from "./is-closed-react-hook-call.js";
import {
  NATIVE_DELAY_MAX_ALIAS_DEPTH,
  PRIVATE_PRIMITIVE_ARRAY_MAX_WORK_STEPS,
  NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT,
  PRIVATE_PRIMITIVE_ARRAY_INDEX_INCREMENT,
  PRIVATE_PRIMITIVE_ARRAY_REF_ARGUMENT_COUNT,
} from "./native-signal-delay/constants.js";

export const createPrivatePrimitiveArrayReadCertificate = (
  scopes: ScopeAnalysis,
  projectIndex?: SourceProjectIndex,
): ((node: EsTreeNode) => boolean) => {
  let steps = 0;
  const completed = new Map<SymbolDescriptor, boolean>();
  const readonlyBindings = new Map<SymbolDescriptor, boolean>();
  let supportedSources: boolean | undefined;
  const protectedHookMethods = new Set(["useRef"]);
  const spend = (): boolean => ++steps <= PRIVATE_PRIMITIVE_ARRAY_MAX_WORK_STEPS;
  const sourcesAreSupported = (): boolean => {
    if (supportedSources !== undefined) return supportedSources;
    if (
      projectIndex &&
      ![...projectIndex.modulesByFilePath.values()].some((module) => module.scopes === scopes)
    )
      return false;
    const programs = projectIndex
      ? [...projectIndex.modulesByFilePath.values()].map((module) => ({
          program: module.programNode,
          scopes: module.scopes,
          erasedDefaultReferences: createErasedDefaultExportCertificate(
            module,
            projectIndex.rootDirectory,
          ),
        }))
      : [{ program: scopes.rootScope.node, scopes, erasedDefaultReferences: undefined }];
    let supported = true;
    for (const source of programs) {
      walkAst(source.program, (node) => {
        if (
          !spend() ||
          !isSupportedRuntimeScopeNode(node, source.scopes, source.erasedDefaultReferences) ||
          !isSupportedNativeDelayWriter(node, source.scopes, protectedHookMethods)
        ) {
          supported = false;
          return false;
        }
        return;
      });
      if (!supported) break;
    }
    supportedSources = supported;
    return supported;
  };
  const readonly = (symbol: SymbolDescriptor): boolean => {
    if (!spend()) return false;
    const previous = readonlyBindings.get(symbol);
    if (previous !== undefined) return previous;
    for (const reference of symbol.references) {
      if (!spend()) return false;
      if (reference.flag !== "read") {
        readonlyBindings.set(symbol, false);
        return false;
      }
    }
    readonlyBindings.set(symbol, true);
    return true;
  };
  const literal = (node: EsTreeNode, depth = 0): EsTreeNode | null => {
    if (!spend() || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) return null;
    const candidate = stripParenExpression(node);
    if (!isNodeOfType(candidate, "Identifier")) return candidate;
    const symbol = scopes.symbolFor(candidate);
    const initializer = symbol && readonly(symbol) && getDirectConstInitializer(symbol);
    return initializer ? literal(initializer, depth + 1) : null;
  };
  const primitive = (node: EsTreeNode | null): boolean =>
    Boolean(
      isNodeOfType(node, "Literal") &&
      !("regex" in node) &&
      (node.value === null ||
        typeof node.value === "string" ||
        typeof node.value === "boolean" ||
        (typeof node.value === "number" && Number.isFinite(node.value))),
    );
  const inBounds = (node: EsTreeNode, length: number, resolveAlias = true): boolean => {
    const value = resolveAlias ? literal(node) : stripParenExpression(node);
    return Boolean(
      isNodeOfType(value, "Literal") &&
      typeof value.value === "number" &&
      Number.isInteger(value.value) &&
      value.value >= 0 &&
      value.value < length,
    );
  };
  const privateBinding = (symbol: SymbolDescriptor): boolean =>
    Boolean(
      getDirectConstInitializer(symbol) &&
      readonly(symbol) &&
      !isNodeOfType(symbol.declarationNode.parent?.parent, "ExportNamedDeclaration"),
    );
  const ownerIsClosed = (owner: EsTreeNode): boolean => {
    const sourceModule =
      projectIndex &&
      [...projectIndex.modulesByFilePath.values()].find((candidate) => candidate.scopes === scopes);
    const top = findTransparentExpressionRoot(owner);
    const parent = top.parent;
    let ownerSymbol: SymbolDescriptor | null = null;
    let exported = false;
    if (isNodeOfType(owner, "FunctionDeclaration")) {
      if (!owner.id) {
        if (!isNodeOfType(parent, "ExportDefaultDeclaration")) return false;
      } else {
        ownerSymbol = scopes.symbolFor(owner.id);
        if (!ownerSymbol) return false;
      }
      exported =
        isNodeOfType(parent, "ExportNamedDeclaration") ||
        isNodeOfType(parent, "ExportDefaultDeclaration");
      if ((exported ? parent?.parent : parent) !== scopes.rootScope.node) return false;
    } else if (
      isNodeOfType(parent, "VariableDeclarator") &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      ownerSymbol = scopes.symbolFor(parent.id);
      if (!ownerSymbol) return false;
      const declaration = parent.parent;
      if (!isNodeOfType(declaration, "VariableDeclaration") || declaration.kind !== "const")
        return false;
      exported = isNodeOfType(declaration.parent, "ExportNamedDeclaration");
      if ((exported ? declaration.parent?.parent : declaration.parent) !== scopes.rootScope.node)
        return false;
    } else if (
      isNodeOfType(parent, "ExportDefaultDeclaration") &&
      parent.parent === scopes.rootScope.node
    )
      exported = true;
    else return false;
    const sourceAliases = new Set<SymbolDescriptor>();
    const inventory = (
      initial: SymbolDescriptor,
      bindingScopes: ScopeAnalysis,
      allowExport: boolean,
    ): boolean => {
      const pending = [initial];
      const visited = new Set<SymbolDescriptor>();
      while (pending.length > 0) {
        if (!spend() || visited.size >= NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT) return false;
        const symbol = pending.pop();
        if (!symbol || visited.has(symbol)) continue;
        if (!symbol.references.every((reference) => spend() && reference.flag === "read"))
          return false;
        visited.add(symbol);
        if (allowExport) sourceAliases.add(symbol);
        if (
          !allowExport &&
          isNodeOfType(symbol.declarationNode.parent?.parent, "ExportNamedDeclaration")
        )
          return false;
        for (const reference of symbol.references) {
          if (!spend()) return false;
          const root = findTransparentExpressionRoot(reference.identifier);
          const use = root.parent;
          if (
            (isNodeOfType(use, "JSXOpeningElement") || isNodeOfType(use, "JSXClosingElement")) &&
            use.name === root
          )
            continue;
          if (
            isNodeOfType(use, "VariableDeclarator") &&
            use.init === root &&
            isNodeOfType(use.id, "Identifier")
          ) {
            const alias = bindingScopes.symbolFor(use.id);
            if (
              !alias ||
              alias.kind !== "const" ||
              (!allowExport && isNodeOfType(use.parent?.parent, "ExportNamedDeclaration"))
            )
              return false;
            if (allowExport && isNodeOfType(use.parent?.parent, "ExportNamedDeclaration"))
              exported = true;
            pending.push(alias);
            continue;
          }
          if (
            allowExport &&
            ((isNodeOfType(use, "ExportSpecifier") &&
              use.local === root &&
              use.exportKind !== "type") ||
              (isNodeOfType(use, "ExportDefaultDeclaration") && use.declaration === root))
          ) {
            exported = true;
            continue;
          }
          return false;
        }
      }
      return true;
    };
    if (ownerSymbol && !inventory(ownerSymbol, scopes, true)) return false;
    if (isNodeOfType(owner, "FunctionDeclaration") && owner.id) {
      const outer = scopes.scopeFor(owner).symbolsByName.get(owner.id.name);
      if (outer && outer !== ownerSymbol && !inventory(outer, scopes, true)) return false;
    }
    if (!exported) return true;
    if (!projectIndex || !sourceModule || projectIndex.hasOpaqueMdxConsumerSurface) return false;
    const refersToOwner = (expression: EsTreeNode, depth = 0): boolean => {
      if (!spend() || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) return false;
      const value = stripParenExpression(expression);
      if (value === owner) return true;
      if (!isNodeOfType(value, "Identifier")) return false;
      const symbol = scopes.symbolFor(value);
      if (!symbol) return false;
      if (sourceAliases.has(symbol)) return true;
      const initial = getDirectConstInitializer(symbol);
      return Boolean(initial && readonly(symbol) && refersToOwner(initial, depth + 1));
    };
    for (const consumer of projectIndex.consumerModulesByFilePath.get(sourceModule.filePath) ??
      []) {
      let valid = true;
      walkAst(consumer.programNode, (node) => {
        if (!valid || !spend()) {
          valid = false;
          return false;
        }
        if (projectIndex.resolvedSourcePathByNode.get(node) !== sourceModule.filePath) return;
        if (isNodeOfType(node, "ImportDeclaration") && isTypeOnlyImport(node)) return;
        if (!isNodeOfType(node, "ImportDeclaration")) {
          valid = false;
          return false;
        }
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            continue;
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            valid = false;
            return false;
          }
          const name = isNodeOfType(specifier, "ImportDefaultSpecifier")
            ? "default"
            : getImportedName(specifier);
          const value = name && findExportedValue(sourceModule.programNode, name);
          if (value && refersToOwner(value)) {
            const imported = consumer.scopes.symbolFor(specifier.local);
            if (!imported || !inventory(imported, consumer.scopes, false)) {
              valid = false;
              return false;
            }
          }
        }
        return;
      });
      if (!valid) return false;
    }
    return true;
  };
  const stableOwner = (symbol: SymbolDescriptor): boolean => {
    const owner = findEnclosingFunction(symbol.bindingIdentifier);
    if (
      !isFunctionLike(owner) ||
      !isComponentFunction(owner) ||
      owner.async ||
      owner.generator ||
      !owner.params.every((parameter) => isNodeOfType(parameter, "Identifier")) ||
      !isNodeOfType(owner.body, "BlockStatement") ||
      symbol.declarationNode.parent?.parent !== owner.body ||
      !ownerIsClosed(owner)
    )
      return false;
    for (const statement of owner.body.body) {
      if (!spend() || !isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const")
        return false;
      for (const declaration of statement.declarations) {
        if (declaration === symbol.declarationNode) return true;
        if (!isNodeOfType(declaration.id, "Identifier") || !declaration.init) return false;
        const initial = stripParenExpression(declaration.init);
        if (primitive(initial)) continue;
        if (
          !isNodeOfType(initial, "CallExpression") ||
          initial.optional ||
          !isClosedReactHookCall(initial, "useRef", scopes) ||
          initial.arguments.length !== PRIVATE_PRIMITIVE_ARRAY_REF_ARGUMENT_COUNT ||
          !primitive(stripParenExpression(initial.arguments[0]))
        )
          return false;
      }
    }
    return false;
  };
  const prove = (source: SymbolDescriptor): boolean => {
    const previous = completed.get(source);
    if (previous !== undefined) return previous;
    const initializer = getDirectConstInitializer(source);
    const array = initializer && stripParenExpression(initializer);
    if (
      !isNodeOfType(array, "ArrayExpression") ||
      array.elements.length === 0 ||
      !array.elements.every((element) => spend() && primitive(element))
    )
      return false;
    const aliases = new Set<SymbolDescriptor>();
    const pending = [source];
    while (pending.length > 0) {
      if (!spend() || aliases.size >= NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT) return false;
      const symbol = pending.pop();
      if (!symbol || aliases.has(symbol)) continue;
      if (!privateBinding(symbol)) return false;
      aliases.add(symbol);
      for (const reference of symbol.references) {
        if (!spend()) return false;
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = scopes.symbolFor(parent.id);
          if (!alias) return false;
          pending.push(alias);
        }
      }
    }
    const arrayMember = (node: EsTreeNode, name: string): boolean => {
      const member = stripParenExpression(node);
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.optional ||
        getStaticPropertyName(member) !== name
      )
        return false;
      const object = stripParenExpression(member.object);
      const symbol = isNodeOfType(object, "Identifier") && scopes.symbolFor(object);
      return Boolean(symbol && aliases.has(symbol));
    };
    const indexRefs = new Map<SymbolDescriptor, boolean>();
    const numericRef = (node: EsTreeNode): boolean => {
      const member = stripParenExpression(node);
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.optional ||
        getStaticPropertyName(member) !== "current" ||
        !isNodeOfType(stripParenExpression(member.object), "Identifier")
      )
        return false;
      const symbol = scopes.symbolFor(stripParenExpression(member.object));
      if (!symbol) return false;
      const previous = indexRefs.get(symbol);
      if (previous !== undefined) return previous;
      const init = getDirectConstInitializer(symbol);
      if (
        !privateBinding(symbol) ||
        !isNodeOfType(init, "CallExpression") ||
        init.optional ||
        !isClosedReactHookCall(init, "useRef", scopes) ||
        init.arguments.length !== PRIVATE_PRIMITIVE_ARRAY_REF_ARGUMENT_COUNT ||
        !inBounds(init.arguments[0], array.elements.length, false) ||
        !stableOwner(symbol)
      )
        return false;
      for (const reference of symbol.references) {
        if (!spend()) return false;
        const root = findTransparentExpressionRoot(reference.identifier);
        const current = root.parent;
        if (
          !isNodeOfType(current, "MemberExpression") ||
          current.object !== root ||
          current.optional ||
          getStaticPropertyName(current) !== "current"
        )
          return false;
        if (!isWithinAssignmentTarget(current)) continue;
        const target = findTransparentExpressionRoot(current);
        const assignment = target.parent;
        if (
          !isNodeOfType(assignment, "AssignmentExpression") ||
          assignment.operator !== "=" ||
          assignment.left !== target
        )
          return false;
        if (inBounds(assignment.right, array.elements.length, false)) continue;
        const remainder = stripParenExpression(assignment.right);
        if (
          !isNodeOfType(remainder, "BinaryExpression") ||
          remainder.operator !== "%" ||
          !arrayMember(remainder.right, "length")
        )
          return false;
        const increment = stripParenExpression(remainder.left);
        if (
          !isNodeOfType(increment, "BinaryExpression") ||
          increment.operator !== "+" ||
          !isNodeOfType(increment.right, "Literal") ||
          increment.right.value !== PRIVATE_PRIMITIVE_ARRAY_INDEX_INCREMENT
        )
          return false;
        const previousCurrent = stripParenExpression(increment.left);
        if (
          !isNodeOfType(previousCurrent, "MemberExpression") ||
          previousCurrent.optional ||
          getStaticPropertyName(previousCurrent) !== "current" ||
          !isNodeOfType(stripParenExpression(previousCurrent.object), "Identifier") ||
          scopes.symbolFor(stripParenExpression(previousCurrent.object)) !== symbol
        )
          return false;
      }
      indexRefs.set(symbol, true);
      return true;
    };
    for (const symbol of aliases)
      for (const reference of symbol.references) {
        if (!spend()) return false;
        const root = findTransparentExpressionRoot(reference.identifier);
        const parent = root.parent;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = scopes.symbolFor(parent.id);
          if (alias && aliases.has(alias)) continue;
        }
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          parent.optional ||
          isWithinAssignmentTarget(parent)
        )
          return false;
        if (!parent.computed && getStaticPropertyName(parent) === "length") continue;
        if (
          !parent.computed ||
          (!inBounds(parent.property, array.elements.length) && !numericRef(parent.property))
        )
          return false;
      }
    completed.set(source, true);
    return true;
  };
  return (node) => {
    steps = 0;
    if (
      !spend() ||
      !sourcesAreSupported() ||
      !isNodeOfType(node, "MemberExpression") ||
      !node.computed ||
      node.optional
    )
      return false;
    const origin = literal(node.object);
    if (
      !isNodeOfType(origin, "ArrayExpression") ||
      !isNodeOfType(stripParenExpression(node.object), "Identifier")
    )
      return false;
    let symbol = scopes.symbolFor(stripParenExpression(node.object));
    for (let depth = 0; symbol && depth < NATIVE_DELAY_MAX_ALIAS_DEPTH; depth += 1) {
      const init = getDirectConstInitializer(symbol);
      if (!init) return false;
      const unwrapped = stripParenExpression(init);
      if (!isNodeOfType(unwrapped, "Identifier")) return prove(symbol);
      symbol = scopes.symbolFor(unwrapped);
    }
    return false;
  };
};
