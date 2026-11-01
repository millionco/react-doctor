import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticJsxDescendantOpeningElements } from "../../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";
import { LABEL_NATIVE_BUTTON_RUNTIME_TYPES } from "./label-native-button-runtime-types.js";

const supportedProgramCache = new WeakMap<EsTreeNode, boolean>();
const readonlySymbolCache = new WeakMap<SymbolDescriptor, boolean>();
const jsxOnlySymbolCache = new WeakMap<SymbolDescriptor, boolean>();

export const hasImportedNativeButtonControlPair = (
  label: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
  labelableNames: ReadonlySet<string>,
): boolean => {
  const isReadonly = (symbol: SymbolDescriptor): boolean => {
    const cached = readonlySymbolCache.get(symbol);
    if (cached !== undefined) return cached;
    const isReadonlyBinding = symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isWithinAssignmentTarget(findTransparentExpressionRoot(reference.identifier)),
    );
    readonlySymbolCache.set(symbol, isReadonlyBinding);
    return isReadonlyBinding;
  };
  const isJsxName = (node: EsTreeNode): boolean =>
    isNodeOfType(node, "JSXIdentifier") &&
    ((isNodeOfType(node.parent, "JSXOpeningElement") && node.parent.name === node) ||
      (isNodeOfType(node.parent, "JSXClosingElement") && node.parent.name === node));
  const hasOnlyJsxReferences = (symbol: SymbolDescriptor): boolean => {
    const cached = jsxOnlySymbolCache.get(symbol);
    if (cached !== undefined) return cached;
    const areAllReferencesJsxNames = symbol.references.every((reference) =>
      isJsxName(reference.identifier),
    );
    jsxOnlySymbolCache.set(symbol, areAllReferencesJsxNames);
    return areAllReferencesJsxNames;
  };
  const supportsProgram = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
    const cached = supportedProgramCache.get(program);
    if (cached !== undefined) return cached;
    let supported = true;
    walkAst(program, (node) => {
      if (!supported) return false;
      if (
        LABEL_NATIVE_BUTTON_RUNTIME_TYPES.has(node.type) ||
        isNodeOfType(node, "ImportExpression") ||
        (isNodeOfType(node, "Identifier") &&
          node.name === "require" &&
          scopes.referenceFor(node)) ||
        (isNodeOfType(node, "TSEnumDeclaration") && !node.declare) ||
        (isNodeOfType(node, "TSModuleDeclaration") && !node.declare) ||
        (isNodeOfType(node, "TSImportEqualsDeclaration") && node.importKind !== "type")
      ) {
        supported = false;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      if (isNodeOfType(node, "Identifier") && node.name === "eval" && scopes.referenceFor(node)) {
        const symbol = scopes.symbolFor(node);
        const declaration = symbol && getImportDeclarationForSymbol(symbol);
        if (
          scopes.isGlobalReference(node) ||
          symbol?.kind === "ts-interface" ||
          symbol?.kind === "ts-type-alias" ||
          (declaration &&
            (isTypeOnlyImport(declaration) ||
              (symbol &&
                isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
                symbol.declarationNode.importKind === "type")))
        )
          supported = false;
      }
    });
    supportedProgramCache.set(program, supported);
    return supported;
  };
  const program = findProgramRoot(label);
  const filename = context.filename;
  if (!program || typeof filename !== "string" || !supportsProgram(program, context.scopes))
    return false;
  const staticAttributes = (
    opening: EsTreeNodeOfType<"JSXOpeningElement">,
  ): Map<string, EsTreeNode | null> | null => {
    const attributes = new Map<string, EsTreeNode | null>();
    for (const attribute of opening.attributes) {
      if (
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        attributes.has(attribute.name.name)
      )
        return null;
      const value = attribute.value;
      attributes.set(
        attribute.name.name,
        isNodeOfType(value, "JSXExpressionContainer")
          ? stripParenExpression(value.expression)
          : value,
      );
    }
    return attributes;
  };
  const hasNativeAncestors = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
    let current = opening.parent?.parent;
    while (current && current !== label) {
      if (isNodeOfType(current, "JSXElement")) {
        const name = current.openingElement.name;
        if (!isNodeOfType(name, "JSXIdentifier") || !/^[a-z]+$/.test(name.name)) return false;
      } else if (!isNodeOfType(current, "JSXFragment")) return false;
      current = current.parent;
    }
    return current === label;
  };
  const isImportedButton = (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
    const attributes = staticAttributes(opening);
    if (!attributes || attributes.has("as") || attributes.has("component")) return false;
    if (attributes.has("asChild")) {
      const value = attributes.get("asChild");
      if (!isNodeOfType(value, "Literal") || value.value !== false) return false;
    }
    if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
    const symbol = context.scopes.symbolFor(opening.name);
    const declaration = symbol && getImportDeclarationForSymbol(symbol);
    if (
      !symbol ||
      !declaration ||
      isTypeOnlyImport(declaration) ||
      !isReadonly(symbol) ||
      symbol.scope.symbols.filter((other) => other.name === symbol.name).length !== 1 ||
      !hasOnlyJsxReferences(symbol) ||
      !isNodeOfType(declaration.source, "Literal") ||
      typeof declaration.source.value !== "string" ||
      !declaration.source.value.startsWith(".")
    )
      return false;
    const specifier = symbol.declarationNode;
    if (
      (!isNodeOfType(specifier, "ImportDefaultSpecifier") &&
        !isNodeOfType(specifier, "ImportSpecifier")) ||
      (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
    )
      return false;
    const source = declaration.source.value;
    const directPath = resolveModulePath(filename, source);
    if (!directPath) return false;
    if (
      !isNodeOfType(program, "Program") ||
      program.body.some(
        (statement) =>
          isNodeOfType(statement, "ImportDeclaration") &&
          statement !== declaration &&
          isNodeOfType(statement.source, "Literal") &&
          typeof statement.source.value === "string" &&
          statement.source.value.startsWith(".") &&
          resolveModulePath(filename, statement.source.value) === directPath,
      ) ||
      declaration.specifiers.length !== 1
    )
      return false;
    const exportedName = isNodeOfType(specifier, "ImportDefaultSpecifier")
      ? "default"
      : getImportedName(specifier);
    if (!exportedName) return false;
    const resolved = resolveCrossFileValueExportWithFilePath(filename, source, exportedName);
    if (!resolved || resolved.filePath !== directPath || !isFunctionLike(resolved.exportedNode))
      return false;
    const component = resolved.exportedNode;
    if (component.async || component.generator) return false;
    const scopes = analyzeScopes(resolved.programNode);
    if (!supportsProgram(resolved.programNode, scopes)) return false;
    const symbols = getFunctionBindingSymbols(component, scopes);
    if (isNodeOfType(component, "FunctionDeclaration") && component.id) {
      const selfSymbol = scopes.symbolFor(component.id);
      if (selfSymbol && !symbols.includes(selfSymbol)) symbols.push(selfSymbol);
    }
    if (
      symbols.length === 0 ||
      symbols.some(
        (binding) =>
          !isReadonly(binding) ||
          binding.scope.symbols.filter((other) => other.name === binding.name).length !== 1 ||
          (!isNodeOfType(component, "FunctionDeclaration") &&
            getDirectConstInitializer(binding) !== component) ||
          binding.references.some((reference) => {
            const node = reference.identifier;
            if (isAstDescendant(node, component)) return true;
            if (isJsxName(node)) return false;
            return !(
              (isNodeOfType(node.parent, "ExportSpecifier") && node.parent.local === node) ||
              (isNodeOfType(node.parent, "ExportDefaultDeclaration") &&
                node.parent.declaration === node)
            );
          }),
      )
    )
      return false;
    let returned: EsTreeNode | null = null;
    if (isNodeOfType(component.body, "BlockStatement")) {
      const last = component.body.body.at(-1);
      if (!isNodeOfType(last, "ReturnStatement") || !last.argument) return false;
      returned = stripParenExpression(last.argument);
      let supported = true;
      walkOwnFunctionScope(component, (node) => {
        if (
          (isNodeOfType(node, "ReturnStatement") && node !== last) ||
          isNodeOfType(node, "IfStatement") ||
          isNodeOfType(node, "SwitchStatement") ||
          isNodeOfType(node, "ThrowStatement") ||
          (node.type.endsWith("Statement") &&
            [
              "ForStatement",
              "ForInStatement",
              "ForOfStatement",
              "WhileStatement",
              "DoWhileStatement",
            ].includes(node.type))
        )
          supported = false;
      });
      if (!supported) return false;
    } else returned = stripParenExpression(component.body);
    if (!isNodeOfType(returned, "JSXElement")) return false;
    const host = returned.openingElement.name;
    if (!isNodeOfType(host, "JSXIdentifier")) return false;
    if (host.name === "button") return true;
    const selector = scopes.symbolFor(host);
    const choice = selector && getDirectConstInitializer(selector);
    if (
      !selector ||
      !choice ||
      !isReadonly(selector) ||
      findEnclosingFunction(selector.declarationNode) !== component ||
      !hasOnlyJsxReferences(selector) ||
      !isNodeOfType(choice, "ConditionalExpression") ||
      !isNodeOfType(choice.test, "Identifier") ||
      !isNodeOfType(choice.alternate, "Literal") ||
      choice.alternate.value !== "button" ||
      !isNodeOfType(choice.consequent, "Identifier")
    )
      return false;
    const slot = scopes.symbolFor(choice.consequent);
    const slotDeclaration = slot && getImportDeclarationForSymbol(slot);
    if (
      !slot ||
      !slotDeclaration ||
      isTypeOnlyImport(slotDeclaration) ||
      (isNodeOfType(slot.declarationNode, "ImportSpecifier") &&
        slot.declarationNode.importKind === "type")
    )
      return false;
    const parameter = scopes.symbolFor(choice.test);
    if (
      !parameter ||
      !isReadonly(parameter) ||
      !parameter.references.every((reference) => reference.identifier === choice.test)
    )
      return false;
    const binding = parameter.bindingIdentifier;
    const assignment = binding.parent;
    const property = assignment?.parent;
    const pattern = property?.parent;
    return (
      isNodeOfType(assignment, "AssignmentPattern") &&
      assignment.left === binding &&
      isNodeOfType(assignment.right, "Literal") &&
      assignment.right.value === false &&
      isNodeOfType(property, "Property") &&
      !property.computed &&
      getStaticPropertyKeyName(property) === "asChild" &&
      isNodeOfType(pattern, "ObjectPattern") &&
      component.params.some((entry) => entry === pattern) &&
      pattern.properties.filter((entry) => getStaticPropertyKeyName(entry) === "asChild").length ===
        1
    );
  };
  let importedButtons = false;
  let nativeControls = false;
  for (const opening of getStaticJsxDescendantOpeningElements(label)) {
    if (!hasNativeAncestors(opening) || !isNodeOfType(opening.name, "JSXIdentifier")) continue;
    const name = opening.name.name;
    if (labelableNames.has(name)) {
      if (name === "input") {
        const attributes = staticAttributes(opening);
        if (!attributes) continue;
        const type = attributes.get("type");
        if (
          attributes.has("type") &&
          (!isNodeOfType(type, "Literal") ||
            typeof type.value !== "string" ||
            type.value.toLowerCase() === "hidden")
        )
          continue;
      }
      nativeControls = true;
    } else if (isImportedButton(opening)) importedButtons = true;
  }
  return importedButtons && nativeControls;
};
