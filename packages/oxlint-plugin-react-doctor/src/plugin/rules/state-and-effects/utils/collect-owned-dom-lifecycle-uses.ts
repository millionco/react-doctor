import { isEventHandlerName } from "./event-handler-reference.js";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type {
  SourceProjectIndex,
  SourceProjectModule,
} from "../../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../../utils/find-enclosing-class.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticThisOrAliasFieldName } from "../../../utils/get-static-this-or-alias-field-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasPossibleStaticPropertyWrite } from "../../../utils/has-static-property-write-before.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../../utils/has-static-property-write-before.js";
import { isReadonlyReactNamespaceJsxReference } from "../../../utils/is-readonly-react-namespace-jsx-reference.js";
import { hasSymbolBindingWrites } from "../../../utils/has-symbol-binding-writes.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isProvenReactClassComponent } from "../../../utils/is-proven-react-class-component.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  OWNED_INPUT_EVENT_SCALAR_NAMES,
  OWNED_DOM_EMPTY_COUNT,
  OWNED_DOM_SINGLE_COUNT,
  OWNED_DOM_PAIR_COUNT,
  OWNED_DOM_NEGATIVE_ONE,
  OWNED_DOM_REACT_CLASS_NAMES,
  OWNED_DOM_CLASS_METADATA_NAMES,
  OWNED_DOM_RESERVED_FIELD_NAMES,
  OWNED_DOM_KEY_EVENT_NAMES,
  OWNED_DOM_KEY_SCALAR_NAMES,
  OWNED_DOM_LISTENER_NAMES,
} from "./constants.js";

export interface OwnedDomLifecycleUsesInput {
  readonly module: SourceProjectModule;
  readonly index: SourceProjectIndex;
  readonly isNativeValue: (value: EsTreeNode) => boolean;
  readonly isPortalContainer: (call: EsTreeNode, value: EsTreeNode) => boolean;
  readonly isReadonlyNativeSnapshot: (
    collection: EsTreeNode,
    module: SourceProjectModule,
  ) => boolean;
}

export interface OwnedDomLifecycleUses {
  readonly approvedNativeUseNodes: ReadonlySet<EsTreeNode>;
  readonly approvedListenerCalls: ReadonlySet<EsTreeNodeOfType<"CallExpression">>;
}

interface OwnedDomFieldWrite {
  readonly target: EsTreeNode;
  readonly value: EsTreeNode;
}

interface OwnedDomMethod {
  readonly name: string;
  readonly definition: EsTreeNode;
  readonly callback: EsTreeNode;
}

interface OwnedDomField {
  readonly name: string;
  readonly writes: readonly OwnedDomFieldWrite[];
  readonly kind: "node" | "collection";
}

const isRuntimeRead = (node: EsTreeNode): boolean =>
  !isNonReferenceIdentifier(node) && !isTypeScriptTypePosition(node);

const isReadonly = (symbol: SymbolDescriptor, module: SourceProjectModule): boolean =>
  !hasSymbolBindingWrites(symbol) &&
  hasCompleteSymbolReferences(symbol, module.programNode, module.scopes);

const readInteger = (rawValue: EsTreeNode): number | null => {
  const value = stripParenExpression(rawValue);
  if (
    isNodeOfType(value, "Literal") &&
    typeof value.value === "number" &&
    Number.isSafeInteger(value.value)
  )
    return value.value;
  if (
    isNodeOfType(value, "UnaryExpression") &&
    value.operator === "-" &&
    isNodeOfType(value.argument, "Literal") &&
    typeof value.argument.value === "number" &&
    Number.isSafeInteger(value.argument.value)
  )
    return -value.argument.value;
  return null;
};

const isEmptySentinel = (rawValue: EsTreeNode): boolean => {
  const value = stripParenExpression(rawValue);
  return (
    (isNodeOfType(value, "Literal") && value.value === null) ||
    (isNodeOfType(value, "ArrayExpression") && value.elements.length === OWNED_DOM_EMPTY_COUNT)
  );
};

const oneArgument = (call: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== OWNED_DOM_SINGLE_COUNT
  )
    return null;
  const argument = call.arguments[OWNED_DOM_EMPTY_COUNT];
  return argument && !isNodeOfType(argument, "SpreadElement") ? argument : null;
};

export const collectOwnedDomLifecycleUses = ({
  module,
  index,
  isNativeValue,
  isPortalContainer,
  isReadonlyNativeSnapshot,
}: OwnedDomLifecycleUsesInput): OwnedDomLifecycleUses => {
  const approvedNativeUseNodes = new Set<EsTreeNode>();
  const approvedListenerCalls = new Set<EsTreeNodeOfType<"CallExpression">>();
  const classes: EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression">[] = [];
  walkAst(module.programNode, (node) => {
    if (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression"))
      classes.push(node);
  });
  for (const classNode of classes) {
    if (!classNode.superClass || !isProvenReactClassComponent(classNode, module.scopes)) continue;
    const superclass = stripParenExpression(classNode.superClass);
    const superclassReceiver = isNodeOfType(superclass, "MemberExpression")
      ? stripParenExpression(superclass.object)
      : superclass;
    const superclassSymbol = isNodeOfType(superclassReceiver, "Identifier")
      ? module.scopes.symbolFor(superclassReceiver)
      : null;
    const superclassImport = superclassSymbol
      ? getImportDeclarationForSymbol(superclassSymbol)
      : null;
    const superclassName = isNodeOfType(superclass, "MemberExpression")
      ? getStaticPropertyKeyName(superclass)
      : superclassSymbol
        ? getImportedName(superclassSymbol.declarationNode)
        : null;
    if (
      !superclassSymbol ||
      superclassImport?.source.value !== "react" ||
      !superclassName ||
      !OWNED_DOM_REACT_CLASS_NAMES.has(superclassName) ||
      !isReadonly(superclassSymbol, module)
    )
      continue;
    const classExpression = findTransparentExpressionRoot(classNode);
    const outerDeclaration = classExpression.parent;
    const outerBinding =
      isNodeOfType(outerDeclaration, "VariableDeclarator") &&
      outerDeclaration.init === classExpression &&
      isNodeOfType(outerDeclaration.id, "Identifier")
        ? module.scopes.symbolFor(outerDeclaration.id)
        : null;
    const classSymbol = classNode.id ? module.scopes.symbolFor(classNode.id) : outerBinding;
    if (
      !classSymbol ||
      !isReadonly(classSymbol, module) ||
      (outerBinding && !isReadonly(outerBinding, module))
    )
      continue;
    let invalid = false;
    for (const candidate of index.modulesByFilePath.values()) {
      for (const symbol of candidate.scopes.rootScope.symbols) {
        const declaration = getImportDeclarationForSymbol(symbol);
        if (declaration?.source.value !== "react" || declaration.importKind === "type") continue;
        if (
          isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
          isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
          getImportedName(symbol.declarationNode) === "default"
        ) {
          if (
            hasPossibleStaticPropertyMutationOrEscape(
              symbol.bindingIdentifier,
              superclassName,
              candidate.scopes,
              (reference) => isReadonlyReactNamespaceJsxReference(reference, candidate.scopes),
            )
          )
            invalid = true;
        }
      }
    }
    const classBindings = new Map<SymbolDescriptor, SourceProjectModule>([[classSymbol, module]]);
    if (outerBinding) classBindings.set(outerBinding, module);
    for (const candidate of index.modulesByFilePath.values()) {
      walkAst(candidate.programNode, (node) => {
        if (
          !isNodeOfType(node, "ImportDeclaration") ||
          node.importKind === "type" ||
          !node.source.value.startsWith(".")
        )
          return;
        for (const specifier of node.specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) continue;
          const importedName = isNodeOfType(specifier, "ImportDefaultSpecifier")
            ? "default"
            : getImportedName(specifier);
          const exported = importedName
            ? resolveCrossFileValueExportWithFilePath(
                candidate.filePath,
                node.source.value,
                importedName,
                { requireCompleteReexports: true },
              )
            : null;
          if (!exported || exported.programNode !== module.programNode) continue;
          const value = stripParenExpression(exported.exportedNode);
          const exportedSymbol = isNodeOfType(value, "Identifier")
            ? module.scopes.symbolFor(value)
            : null;
          if (
            value !== classNode &&
            exportedSymbol !== classSymbol &&
            exportedSymbol?.declarationNode !== classNode
          )
            continue;
          const binding = candidate.scopes.symbolFor(specifier.local);
          if (binding) classBindings.set(binding, candidate);
        }
      });
    }
    const reachesClassModule = (
      candidate: SourceProjectModule,
      visited = new Set<SourceProjectModule>(),
    ): boolean => {
      if (candidate === module) return true;
      if (visited.has(candidate)) return false;
      visited.add(candidate);
      let reaches = false;
      walkAst(candidate.programNode, (node) => {
        const resolvedPath = index.resolvedSourcePathByNode.get(node);
        const dependency = resolvedPath ? index.modulesByFilePath.get(resolvedPath) : undefined;
        if (dependency && reachesClassModule(dependency, new Set(visited))) reaches = true;
      });
      return reaches;
    };
    for (const candidate of index.modulesByFilePath.values()) {
      walkAst(candidate.programNode, (node) => {
        if (
          !(
            isNodeOfType(node, "ImportDeclaration") &&
            node.specifiers.some((specifier) => isNodeOfType(specifier, "ImportNamespaceSpecifier"))
          ) &&
          !(isNodeOfType(node, "ExportAllDeclaration") && node.exported)
        )
          return;
        const resolvedPath = index.resolvedSourcePathByNode.get(node);
        const dependency = resolvedPath ? index.modulesByFilePath.get(resolvedPath) : undefined;
        if (dependency && reachesClassModule(dependency)) invalid = true;
      });
    }
    const staticComponentSlots = new Set(
      classNode.body.body.flatMap((member) => {
        if (!isNodeOfType(member, "PropertyDefinition") || !member.static || !member.value)
          return [];
        const name = getStaticPropertyKeyName(member);
        const value = stripParenExpression(member.value);
        const symbol = isNodeOfType(value, "Identifier") ? module.scopes.symbolFor(value) : null;
        return name && symbol && getImportDeclarationForSymbol(symbol) && isReadonly(symbol, module)
          ? [name]
          : [];
      }),
    );
    const hasKnownInstanceRef = (
      rawValue: EsTreeNode,
      owner: SourceProjectModule,
      visited = new Set<SymbolDescriptor>(),
    ): boolean => {
      const value = stripParenExpression(rawValue);
      if (isNodeOfType(value, "Identifier")) {
        const symbol = owner.scopes.symbolFor(value);
        if (!symbol || visited.has(symbol)) return false;
        if (hasPossibleStaticPropertyWrite(value, "ref", owner.scopes)) return true;
        const initial = getDirectUnreassignedInitializer(symbol);
        return Boolean(
          initial &&
          isReadonly(symbol, owner) &&
          hasKnownInstanceRef(initial, owner, new Set(visited).add(symbol)),
        );
      }
      if (!isNodeOfType(value, "ObjectExpression")) return false;
      return value.properties.some((property) => {
        if (isNodeOfType(property, "SpreadElement"))
          return hasKnownInstanceRef(property.argument, owner, new Set(visited));
        if (!isNodeOfType(property, "Property")) return true;
        const name = getStaticPropertyKeyName(property, { allowComputedString: true });
        return name === null || name === "ref";
      });
    };
    for (const [binding, owner] of classBindings) {
      if (!isReadonly(binding, owner)) {
        invalid = true;
        break;
      }
      for (const reference of binding.references) {
        if (!isRuntimeRead(reference.identifier)) continue;
        const value = findTransparentExpressionRoot(reference.identifier);
        const parent = value.parent;
        if (
          (isNodeOfType(parent, "JSXOpeningElement") ||
            isNodeOfType(parent, "JSXClosingElement")) &&
          parent.name === value
        ) {
          if (
            isNodeOfType(parent, "JSXOpeningElement") &&
            parent.attributes.some(
              (attribute) =>
                (isNodeOfType(attribute, "JSXAttribute") &&
                  isNodeOfType(attribute.name, "JSXIdentifier") &&
                  attribute.name.name === "ref") ||
                (isNodeOfType(attribute, "JSXSpreadAttribute") &&
                  hasKnownInstanceRef(attribute.argument, owner)),
            )
          )
            invalid = true;
          continue;
        }
        if (
          isNodeOfType(parent, "ExportSpecifier") ||
          isNodeOfType(parent, "ExportDefaultDeclaration")
        )
          continue;
        if (
          isNodeOfType(parent, "JSXMemberExpression") &&
          parent.object === value &&
          isNodeOfType(parent.property, "JSXIdentifier") &&
          staticComponentSlots.has(parent.property.name)
        )
          continue;
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === value &&
          staticComponentSlots.has(getStaticPropertyKeyName(parent) ?? "") &&
          !isMemberMutationTarget(parent)
        )
          continue;
        if (
          isNodeOfType(parent, "Property") &&
          parent.value === value &&
          !parent.computed &&
          parent.kind === "init" &&
          !parent.method &&
          getStaticPropertyKeyName(parent) === "component" &&
          isNodeOfType(parent.parent, "ObjectExpression") &&
          parent.parent.properties.length === OWNED_DOM_PAIR_COUNT &&
          parent.parent.properties.every(
            (property) =>
              isNodeOfType(property, "Property") &&
              !property.computed &&
              !property.method &&
              property.kind === "init" &&
              (property === parent ||
                (getStaticPropertyKeyName(property) === "title" &&
                  isNodeOfType(property.value, "Literal") &&
                  typeof property.value.value === "string")),
          )
        )
          continue;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === value &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = owner.scopes.symbolFor(parent.id);
          if (alias && isReadonly(alias, owner)) {
            classBindings.set(alias, owner);
            continue;
          }
        }
        if (
          isNodeOfType(parent, "MemberExpression") &&
          parent.object === value &&
          OWNED_DOM_CLASS_METADATA_NAMES.has(getStaticPropertyKeyName(parent) ?? "") &&
          isNodeOfType(parent.parent, "AssignmentExpression") &&
          parent.parent.left === parent &&
          parent.parent.operator === "="
        )
          continue;
        invalid = true;
      }
    }
    if (invalid) continue;
    const own = (node: EsTreeNode): boolean => findEnclosingClass(node) === classNode;
    const fieldName = (rawValue: EsTreeNode): string | null => {
      const value = stripParenExpression(rawValue);
      if (!isNodeOfType(value, "MemberExpression") || !own(value)) return null;
      return getStaticThisOrAliasFieldName(value, new Set<string>(), classNode);
    };
    const definitions = new Map<string, EsTreeNode[]>();
    const methods = new Map<string, OwnedDomMethod>();
    const writes = new Map<string, OwnedDomFieldWrite[]>();
    const fieldReferences: EsTreeNodeOfType<"MemberExpression">[] = [];
    const addWrite = (name: string, target: EsTreeNode, value: EsTreeNode) =>
      writes.set(name, [...(writes.get(name) ?? []), { target, value }]);
    for (const member of classNode.body.body) {
      const name = getStaticPropertyKeyName(member, { allowComputedString: true });
      if (
        !name ||
        (!isNodeOfType(member, "PropertyDefinition") && !isNodeOfType(member, "MethodDefinition"))
      ) {
        invalid = true;
        break;
      }
      definitions.set(name, [...(definitions.get(name) ?? []), member]);
      if (member.static) continue;
      if (isNodeOfType(member, "PropertyDefinition") && member.value) {
        if (isFunctionLike(stripParenExpression(member.value)))
          methods.set(name, {
            name,
            definition: member,
            callback: stripParenExpression(member.value),
          });
        else addWrite(name, member, member.value);
      } else if (
        isNodeOfType(member, "MethodDefinition") &&
        member.kind === "method" &&
        isFunctionLike(member.value)
      )
        methods.set(name, { name, definition: member, callback: member.value });
    }
    const hasClassThis = (node: EsTreeNode): boolean => {
      let current: EsTreeNode | null | undefined = node.parent;
      while (current && current !== classNode) {
        if (isNodeOfType(current, "PropertyDefinition") && current.static) return false;
        if (isFunctionLike(current) && current.type !== "ArrowFunctionExpression") {
          return (
            isNodeOfType(current.parent, "MethodDefinition") &&
            !current.parent.static &&
            current.parent.parent === classNode.body
          );
        }
        current = current.parent;
      }
      return current === classNode;
    };
    walkAst(classNode, (node) => {
      if (
        node !== classNode &&
        (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression"))
      )
        return false;
      if (
        node.type === "Decorator" ||
        (isNodeOfType(node, "Identifier") &&
          node.name === "event" &&
          module.scopes.referenceFor(node) &&
          module.scopes.isGlobalReference(node))
      )
        invalid = true;
      if (isNodeOfType(node, "ThisExpression")) {
        const root = findTransparentExpressionRoot(node);
        if (
          !hasClassThis(node) ||
          !isNodeOfType(root.parent, "MemberExpression") ||
          root.parent.object !== root ||
          fieldName(root.parent) === null
        )
          invalid = true;
      }
      if (!isNodeOfType(node, "MemberExpression") || fieldName(node) === null) return;
      fieldReferences.push(node);
      const root = findTransparentExpressionRoot(node);
      const parent = root.parent;
      if (
        isNodeOfType(parent, "AssignmentExpression") &&
        parent.left === root &&
        parent.operator === "="
      )
        addWrite(fieldName(node) ?? "", node, parent.right);
    });
    if (invalid) continue;
    const fields = new Map<string, OwnedDomField>();
    const collectionKey = (value: EsTreeNode): string | null => fieldName(value);
    const resolveKind = (
      rawValue: EsTreeNode,
      visited = new Set<SymbolDescriptor>(),
    ): "node" | "collection" | null => {
      const value = stripParenExpression(rawValue);
      const name = fieldName(value);
      if (name) return fields.get(name)?.kind ?? null;
      if (isNodeOfType(value, "Identifier")) {
        const symbol = module.scopes.symbolFor(value);
        if (!symbol || visited.has(symbol) || !isReadonly(symbol, module)) return null;
        const initial = getDirectUnreassignedInitializer(symbol);
        return initial ? resolveKind(initial, new Set(visited).add(symbol)) : null;
      }
      if (isNativeValue(value)) {
        if (
          isNodeOfType(value, "MemberExpression") &&
          ["body", "activeElement"].includes(getStaticPropertyKeyName(value) ?? "")
        )
          return "node";
        if (
          isNodeOfType(value, "CallExpression") &&
          isNodeOfType(stripParenExpression(value.callee), "MemberExpression")
        ) {
          const callee = stripParenExpression(value.callee);
          const argument = oneArgument(value);
          if (
            isNodeOfType(callee, "MemberExpression") &&
            getStaticPropertyKeyName(callee) === "createElement" &&
            isNodeOfType(argument, "Literal") &&
            typeof argument.value === "string" &&
            HTML_TAGS.has(argument.value)
          )
            return "node";
        }
      }
      if (isNodeOfType(value, "MemberExpression")) {
        const receiverKind = resolveKind(value.object, new Set(visited));
        if (
          !value.computed &&
          getStaticPropertyKeyName(value) === "children" &&
          receiverKind === "node"
        )
          return "collection";
        if (
          value.computed &&
          receiverKind === "collection" &&
          isCollectionIndex(value.property, value.object)
        )
          return "node";
      }
      if (isNodeOfType(value, "CallExpression") && !value.optional) {
        const callee = stripParenExpression(value.callee);
        const argument = oneArgument(value);
        if (
          isNodeOfType(callee, "MemberExpression") &&
          !callee.optional &&
          getStaticPropertyKeyName(callee) === "querySelectorAll" &&
          resolveKind(callee.object, new Set(visited)) === "node" &&
          argument &&
          getStaticStringExpression(argument) !== null
        )
          return "collection";
      }
      return null;
    };
    const isFindIndexResult = (rawValue: EsTreeNode, collection: EsTreeNode): boolean => {
      const value = stripParenExpression(rawValue);
      const symbol = isNodeOfType(value, "Identifier") ? module.scopes.symbolFor(value) : null;
      if (!symbol || !isReadonly(symbol, module)) return false;
      const initial = getDirectUnreassignedInitializer(symbol);
      if (!initial || !isNodeOfType(stripParenExpression(initial), "CallExpression")) return false;
      const call = stripParenExpression(initial);
      if (!isNodeOfType(call, "CallExpression")) return false;
      const callee = stripParenExpression(call.callee);
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        getStaticPropertyKeyName(callee) !== "findIndex"
      )
        return false;
      const snapshot = stripParenExpression(callee.object);
      if (
        !isNodeOfType(snapshot, "ArrayExpression") ||
        snapshot.elements.length !== OWNED_DOM_SINGLE_COUNT
      )
        return false;
      const spread = snapshot.elements[OWNED_DOM_EMPTY_COUNT];
      return Boolean(
        isNodeOfType(spread, "SpreadElement") &&
        collectionKey(collection) !== null &&
        collectionKey(spread.argument) === collectionKey(collection) &&
        isReadonlyNativeSnapshot(spread.argument, module),
      );
    };
    const isCollectionIndex = (rawValue: EsTreeNode, collection: EsTreeNode): boolean => {
      const value = stripParenExpression(rawValue);
      const integer = readInteger(value);
      if (integer !== null) return integer >= OWNED_DOM_EMPTY_COUNT;
      if (
        isNodeOfType(value, "BinaryExpression") &&
        value.operator === "-" &&
        readInteger(value.right) === OWNED_DOM_SINGLE_COUNT
      ) {
        const length = stripParenExpression(value.left);
        return (
          isNodeOfType(length, "MemberExpression") &&
          getStaticPropertyKeyName(length) === "length" &&
          collectionKey(collection) !== null &&
          collectionKey(length.object) === collectionKey(collection)
        );
      }
      if (
        !isNodeOfType(value, "ConditionalExpression") ||
        readInteger(value.alternate) !== OWNED_DOM_EMPTY_COUNT ||
        !isFindIndexResult(value.consequent, collection)
      )
        return false;
      const test = stripParenExpression(value.test);
      return (
        isNodeOfType(test, "BinaryExpression") &&
        test.operator === ">" &&
        readInteger(test.right) === OWNED_DOM_NEGATIVE_ONE &&
        isFindIndexResult(test.left, collection) &&
        module.scopes.symbolFor(stripParenExpression(test.left)) ===
          module.scopes.symbolFor(stripParenExpression(value.consequent))
      );
    };
    for (let changed = true; changed; ) {
      changed = false;
      for (const [name, candidates] of writes) {
        if (fields.has(name) || OWNED_DOM_RESERVED_FIELD_NAMES.has(name)) continue;
        const sourceKinds = candidates
          .filter((candidate) => !isEmptySentinel(candidate.value))
          .map((candidate) => resolveKind(candidate.value));
        if (sourceKinds.length !== OWNED_DOM_SINGLE_COUNT || !sourceKinds[OWNED_DOM_EMPTY_COUNT])
          continue;
        const kind = sourceKinds[OWNED_DOM_EMPTY_COUNT];
        if (
          !kind ||
          candidates.some(
            (candidate) =>
              !isEmptySentinel(candidate.value) && resolveKind(candidate.value) !== kind,
          )
        )
          continue;
        fields.set(name, { name, writes: candidates, kind });
        changed = true;
      }
    }
    const classApproved = new Set<EsTreeNode>();
    const listeners = new Set<EsTreeNodeOfType<"CallExpression">>();
    const approve = (node: EsTreeNode) => {
      classApproved.add(node);
      classApproved.add(findTransparentExpressionRoot(node));
    };
    const isOwnAssignment = (value: EsTreeNode): boolean =>
      [...fields.values()].some((field) =>
        field.writes.some(
          (write) =>
            findTransparentExpressionRoot(write.value) === value &&
            (isNodeOfType(write.target, "PropertyDefinition") ||
              (isNodeOfType(value.parent, "AssignmentExpression") &&
                value.parent.left === findTransparentExpressionRoot(write.target))),
        ),
      );
    const checkedAliases = new Set<SymbolDescriptor>();
    const isClosedNativeRead = (rawValue: EsTreeNode, kind: "node" | "collection"): boolean => {
      const value = findTransparentExpressionRoot(rawValue);
      const parent = value.parent;
      if (!parent) return false;
      if (isOwnAssignment(value)) {
        approve(value);
        return true;
      }
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === value &&
        parent.parent?.type === "VariableDeclaration" &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const symbol = module.scopes.symbolFor(parent.id);
        if (!symbol || !isReadonly(symbol, module)) return false;
        if (checkedAliases.has(symbol)) return true;
        checkedAliases.add(symbol);
        return symbol.references.every(
          (reference) =>
            !isRuntimeRead(reference.identifier) || isClosedNativeRead(reference.identifier, kind),
        );
      }
      if (isPortalContainer(parent, value) && kind === "node") {
        approve(value);
        return true;
      }
      if (
        kind === "node" &&
        isNodeOfType(parent, "CallExpression") &&
        oneArgument(parent) === value
      ) {
        const callee = stripParenExpression(parent.callee);
        if (
          isNodeOfType(callee, "MemberExpression") &&
          !callee.optional &&
          ["contains", "appendChild", "removeChild"].includes(
            getStaticPropertyKeyName(callee) ?? "",
          ) &&
          (resolveKind(callee.object) === "node" || isNativeValue(callee.object))
        ) {
          approve(value);
          return true;
        }
      }
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === value &&
        !isMemberMutationTarget(parent)
      ) {
        const name = getStaticPropertyKeyName(parent, { allowComputedString: true });
        if (kind === "collection") {
          if (name === "length") return true;
          return (
            parent.computed &&
            isCollectionIndex(parent.property, value) &&
            isClosedNativeRead(parent, "node")
          );
        }
        if (name === "children") return isClosedNativeRead(parent, "collection");
        const call = findTransparentExpressionRoot(parent).parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          call.callee !== findTransparentExpressionRoot(parent)
        )
          return false;
        if (name === "focus" && call.arguments.length === OWNED_DOM_EMPTY_COUNT) return true;
        const argument = oneArgument(call);
        if (name === "querySelectorAll" && argument && getStaticStringExpression(argument) !== null)
          return isClosedNativeRead(call, "collection");
        if (
          (name === "contains" || name === "appendChild" || name === "removeChild") &&
          argument &&
          (resolveKind(argument) === "node" || isNativeValue(argument))
        ) {
          approve(argument);
          return true;
        }
        return false;
      }
      if (kind === "collection" && isReadonlyNativeSnapshot(value, module)) return true;
      if (
        (isNodeOfType(parent, "BinaryExpression") && ["===", "!=="].includes(parent.operator)) ||
        (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
        (isNodeOfType(parent, "IfStatement") && parent.test === value) ||
        (isNodeOfType(parent, "LogicalExpression") &&
          parent.operator === "&&" &&
          parent.left === value)
      )
        return true;
      return false;
    };
    for (const field of fields.values()) {
      const ownDefinitions = definitions.get(field.name) ?? [];
      if (
        ownDefinitions.some(
          (definition) => !isNodeOfType(definition, "PropertyDefinition") || definition.static,
        ) ||
        ownDefinitions.length > OWNED_DOM_SINGLE_COUNT
      ) {
        invalid = true;
        break;
      }
      for (const write of field.writes) {
        approve(write.value);
        approve(write.target);
      }
      for (const reference of fieldReferences.filter(
        (reference) => fieldName(reference) === field.name,
      )) {
        if (isMemberMutationTarget(reference)) {
          const root = findTransparentExpressionRoot(reference);
          if (
            !isNodeOfType(root.parent, "AssignmentExpression") ||
            root.parent.left !== root ||
            root.parent.operator !== "=" ||
            !field.writes.some((write) => write.target === reference)
          ) {
            invalid = true;
            break;
          }
        } else if (!isClosedNativeRead(reference, field.kind)) {
          invalid = true;
          break;
        }
      }
    }
    if (invalid) continue;
    for (const [name, method] of methods) {
      const callback = method.callback;
      if (
        !isFunctionLike(callback) ||
        callback.async ||
        callback.generator ||
        callback.params.length !== OWNED_DOM_SINGLE_COUNT ||
        !isNodeOfType(callback.params[OWNED_DOM_EMPTY_COUNT], "Identifier") ||
        !isNodeOfType(callback.body, "BlockStatement")
      )
        continue;
      const parameter = callback.params[OWNED_DOM_EMPTY_COUNT];
      const symbol = module.scopes.symbolFor(parameter);
      const [guard, ...extra] = callback.body.body;
      if (
        !symbol ||
        !isReadonly(symbol, module) ||
        extra.length ||
        !isNodeOfType(guard, "IfStatement") ||
        guard.alternate
      )
        continue;
      const consequence = isNodeOfType(guard.consequent, "BlockStatement")
        ? guard.consequent.body
        : [guard.consequent];
      const [statement, ...other] = consequence;
      const expression = isNodeOfType(statement, "ExpressionStatement")
        ? stripParenExpression(statement.expression)
        : null;
      const callee = isNodeOfType(expression, "CallExpression")
        ? stripParenExpression(expression.callee)
        : null;
      if (
        other.length ||
        !isNodeOfType(expression, "CallExpression") ||
        expression.optional ||
        expression.arguments.length ||
        !isNodeOfType(callee, "MemberExpression") ||
        getStaticPropertyKeyName(callee) !== "focus" ||
        module.scopes.symbolFor(stripParenExpression(callee.object)) !== symbol
      )
        continue;
      const isGuard = (node: EsTreeNode): boolean => {
        const value = stripParenExpression(node);
        if (isNodeOfType(value, "Identifier")) return module.scopes.symbolFor(value) === symbol;
        if (isNodeOfType(value, "LogicalExpression") && value.operator === "&&")
          return isGuard(value.left) && isGuard(value.right);
        if (
          !isNodeOfType(value, "BinaryExpression") ||
          value.operator !== "!==" ||
          module.scopes.symbolFor(stripParenExpression(value.left)) !== symbol
        )
          return false;
        const right = stripParenExpression(value.right);
        return isNodeOfType(right, "Literal") && right.value === null;
      };
      if (
        !isGuard(guard.test) ||
        definitions.get(name)?.length !== OWNED_DOM_SINGLE_COUNT ||
        (writes.get(name)?.length ?? OWNED_DOM_EMPTY_COUNT) !== OWNED_DOM_EMPTY_COUNT
      )
        continue;
      const allowedParameterReads = new Set<EsTreeNode>();
      walkAst(guard.test, (node) => {
        if (isNodeOfType(node, "Identifier") && module.scopes.symbolFor(node) === symbol)
          allowedParameterReads.add(node);
      });
      allowedParameterReads.add(stripParenExpression(callee.object));
      if (!symbol.references.every((reference) => allowedParameterReads.has(reference.identifier)))
        continue;
      const references = fieldReferences.filter((reference) => fieldName(reference) === name);
      const calls: EsTreeNode[] = [];
      let closed = references.length > OWNED_DOM_EMPTY_COUNT;
      for (const reference of references) {
        const root = findTransparentExpressionRoot(reference);
        const call = root.parent;
        const argument = oneArgument(call ?? reference);
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== root ||
          !argument ||
          (!isNativeValue(argument) && resolveKind(argument) !== "node")
        ) {
          closed = false;
          break;
        }
        calls.push(argument);
      }
      if (closed) for (const argument of calls) approve(argument);
    }
    const keyMethods = new Map<string, OwnedDomMethod>();
    const eventSymbols = new Map<EsTreeNode, SymbolDescriptor | null>();
    const scalarSymbols = new Map<EsTreeNode, readonly SymbolDescriptor[]>();
    const listenerRoots: Array<{
      readonly call: EsTreeNodeOfType<"CallExpression">;
      readonly name: string;
    }> = [];
    const isOwnListener = (rawCall: EsTreeNode): rawCall is EsTreeNodeOfType<"CallExpression"> => {
      const call = stripParenExpression(rawCall);
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.arguments.length < OWNED_DOM_PAIR_COUNT ||
        call.arguments.length > OWNED_DOM_PAIR_COUNT + OWNED_DOM_SINGLE_COUNT
      )
        return false;
      const capture = call.arguments[OWNED_DOM_PAIR_COUNT];
      if (capture && (!isNodeOfType(capture, "Literal") || typeof capture.value !== "boolean"))
        return false;
      const callee = stripParenExpression(call.callee);
      const event = call.arguments[OWNED_DOM_EMPTY_COUNT];
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        callee.optional ||
        !OWNED_DOM_LISTENER_NAMES.has(getStaticPropertyKeyName(callee) ?? "") ||
        !isNodeOfType(event, "Literal") ||
        typeof event.value !== "string" ||
        !OWNED_DOM_KEY_EVENT_NAMES.has(event.value)
      )
        return false;
      const receiver = stripParenExpression(callee.object);
      return (
        isNodeOfType(receiver, "Identifier") &&
        (receiver.name === "window" || receiver.name === "document") &&
        module.scopes.isGlobalReference(receiver)
      );
    };
    const addKeyMethod = (name: string): boolean => {
      if (keyMethods.has(name)) return true;
      const method = methods.get(name);
      if (
        !method ||
        !isNodeOfType(method.definition, "PropertyDefinition") ||
        method.definition.static ||
        definitions.get(name)?.length !== OWNED_DOM_SINGLE_COUNT ||
        (writes.get(name)?.length ?? OWNED_DOM_EMPTY_COUNT) !== OWNED_DOM_EMPTY_COUNT
      )
        return false;
      const callback = method.callback;
      if (
        !isNodeOfType(callback, "ArrowFunctionExpression") ||
        callback.async ||
        callback.params.length > OWNED_DOM_SINGLE_COUNT
      )
        return false;
      const parameter = callback.params[OWNED_DOM_EMPTY_COUNT];
      const scalars: SymbolDescriptor[] = [];
      let object: SymbolDescriptor | null = null;
      if (parameter) {
        if (isNodeOfType(parameter, "Identifier")) {
          object = module.scopes.symbolFor(parameter);
          if (!object || !isReadonly(object, module)) return false;
        } else if (isNodeOfType(parameter, "ObjectPattern")) {
          for (const property of parameter.properties) {
            if (
              !isNodeOfType(property, "Property") ||
              property.computed ||
              !isNodeOfType(property.value, "Identifier") ||
              !OWNED_DOM_KEY_SCALAR_NAMES.has(getStaticPropertyKeyName(property) ?? "")
            )
              return false;
            const symbol = module.scopes.symbolFor(property.value);
            if (!symbol || !isReadonly(symbol, module)) return false;
            scalars.push(symbol);
          }
        } else return false;
      }
      let usesArguments = false;
      walkAst(callback, (node) => {
        if (
          isNodeOfType(node, "Identifier") &&
          node.name === "arguments" &&
          module.scopes.referenceFor(node)
        )
          usesArguments = true;
      });
      if (usesArguments) return false;
      keyMethods.set(name, method);
      eventSymbols.set(callback, object);
      scalarSymbols.set(callback, scalars);
      return true;
    };
    walkAst(classNode, (node) => {
      if (!own(node) || !isOwnListener(node)) return;
      const callback = node.arguments[OWNED_DOM_SINGLE_COUNT];
      const name = callback ? fieldName(callback) : null;
      if (name && addKeyMethod(name)) listenerRoots.push({ call: node, name });
    });
    const isEventObjectRead = (
      rawValue: EsTreeNode,
      owner: OwnedDomMethod,
      visited = new Set<SymbolDescriptor>(),
    ): boolean => {
      const value = stripParenExpression(rawValue);
      if (!isNodeOfType(value, "Identifier")) return false;
      const symbol = module.scopes.symbolFor(value);
      if (!symbol || visited.has(symbol)) return false;
      if (eventSymbols.get(owner.callback) === symbol) return true;
      const initial = getDirectUnreassignedInitializer(symbol);
      return Boolean(
        initial &&
        isReadonly(symbol, module) &&
        isEventObjectRead(initial, owner, new Set(visited).add(symbol)),
      );
    };
    for (const method of keyMethods.values()) {
      walkAst(method.callback, (node) => {
        if (
          !isNodeOfType(node, "CallExpression") ||
          node.optional ||
          findEnclosingFunction(node) !== method.callback
        )
          return;
        const callee = stripParenExpression(node.callee);
        const name = fieldName(callee);
        const argument = oneArgument(node);
        if (name && argument && isEventObjectRead(argument, method) && !addKeyMethod(name))
          invalid = true;
      });
    }
    const checkedEvents = new Set<SymbolDescriptor>();
    const isClosedEventRead = (rawValue: EsTreeNode, owner: OwnedDomMethod): boolean => {
      const value = findTransparentExpressionRoot(rawValue);
      const parent = value.parent;
      if (!parent) return false;
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === value &&
        isNodeOfType(parent.id, "Identifier")
      ) {
        const symbol = module.scopes.symbolFor(parent.id);
        if (!symbol || !isReadonly(symbol, module)) return false;
        if (checkedEvents.has(symbol)) return true;
        checkedEvents.add(symbol);
        return symbol.references.every(
          (reference) =>
            !isRuntimeRead(reference.identifier) || isClosedEventRead(reference.identifier, owner),
        );
      }
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === value &&
        !isMemberMutationTarget(parent)
      ) {
        const name = getStaticPropertyKeyName(parent);
        if (name && OWNED_DOM_KEY_SCALAR_NAMES.has(name)) return true;
        const call = findTransparentExpressionRoot(parent).parent;
        return (
          name === "preventDefault" &&
          isNodeOfType(call, "CallExpression") &&
          !call.optional &&
          call.callee === findTransparentExpressionRoot(parent) &&
          call.arguments.length === OWNED_DOM_EMPTY_COUNT
        );
      }
      if (
        !isNodeOfType(parent, "CallExpression") ||
        oneArgument(parent) !== value ||
        findEnclosingFunction(parent) !== owner.callback
      )
        return false;
      const name = fieldName(parent.callee);
      return Boolean(name && keyMethods.has(name));
    };
    for (const method of keyMethods.values()) {
      const symbol = eventSymbols.get(method.callback);
      if (
        symbol &&
        !symbol.references.every(
          (reference) =>
            !isRuntimeRead(reference.identifier) || isClosedEventRead(reference.identifier, method),
        )
      )
        invalid = true;
      for (const scalar of scalarSymbols.get(method.callback) ?? [])
        if (!isReadonly(scalar, module)) invalid = true;
      for (const reference of fieldReferences.filter(
        (reference) => fieldName(reference) === method.name,
      )) {
        const value = findTransparentExpressionRoot(reference);
        const parent = value.parent;
        if (
          isNodeOfType(parent, "CallExpression") &&
          isOwnListener(parent) &&
          parent.arguments[OWNED_DOM_SINGLE_COUNT] === value
        )
          continue;
        if (!isNodeOfType(parent, "CallExpression") || parent.optional || parent.callee !== value) {
          invalid = true;
          break;
        }
        const caller = [...keyMethods.values()].find(
          (candidate) => candidate.callback === findEnclosingFunction(parent),
        );
        const argument = oneArgument(parent);
        if (!caller || !argument || !isEventObjectRead(argument, caller)) {
          invalid = true;
          break;
        }
      }
    }
    const jsxCallbacks = new Map<
      EsTreeNode,
      { readonly method: OwnedDomMethod | null; readonly binding: SymbolDescriptor | null }
    >();
    const hasKnownOwnEventCallback = (
      rawValue: EsTreeNode,
      seen = new Set<SymbolDescriptor>(),
    ): boolean => {
      const value = stripParenExpression(rawValue);
      if (isFunctionLike(value)) return true;
      const name = fieldName(value);
      if (name && (methods.has(name) || writes.has(name))) return true;
      if (isNodeOfType(value, "Identifier")) {
        const symbol = module.scopes.symbolFor(value);
        if (!symbol || seen.has(symbol)) return false;
        const callback = resolveExactLocalFunction(value, module.scopes);
        if (callback && findProgramRoot(callback) === module.programNode) return true;
        const declaration = symbol.declarationNode;
        const initial = isNodeOfType(declaration, "VariableDeclarator") ? declaration.init : null;
        return Boolean(initial && hasKnownOwnEventCallback(initial, new Set(seen).add(symbol)));
      }
      let found = false;
      walkAst(value, (child) => {
        if (
          child !== value &&
          (isFunctionLike(child) ||
            (((isNodeOfType(child, "Identifier") && isRuntimeRead(child)) ||
              isNodeOfType(child, "MemberExpression")) &&
              hasKnownOwnEventCallback(child, new Set(seen))))
        ) {
          found = true;
          return false;
        }
      });
      return found;
    };
    walkAst(classNode, (node) => {
      if (
        !isNodeOfType(node, "JSXAttribute") ||
        !isNodeOfType(node.name, "JSXIdentifier") ||
        !isEventHandlerName(node.name.name) ||
        !isNodeOfType(node.value, "JSXExpressionContainer") ||
        findEnclosingClass(node) !== classNode
      )
        return;
      const value = stripParenExpression(node.value.expression);
      const name = fieldName(value);
      if (name) {
        const method = methods.get(name);
        if (!method) invalid = true;
        else jsxCallbacks.set(method.callback, { method, binding: null });
        return;
      }
      if (isNodeOfType(value, "ArrowFunctionExpression")) {
        jsxCallbacks.set(value, { method: null, binding: null });
        return;
      }
      if (!isNodeOfType(value, "Identifier")) {
        if (hasKnownOwnEventCallback(value)) invalid = true;
        return;
      }
      const binding = module.scopes.symbolFor(value);
      const callback = resolveExactLocalFunction(value, module.scopes);
      if (callback && findProgramRoot(callback) === module.programNode) {
        if (
          !binding ||
          !isReadonly(binding, module) ||
          !getFunctionBindingSymbols(callback, module.scopes).includes(binding)
        )
          invalid = true;
        else jsxCallbacks.set(callback, { method: null, binding });
        return;
      }
      if (hasKnownOwnEventCallback(value)) invalid = true;
    });
    for (const [callback, { method, binding }] of jsxCallbacks) {
      if (
        !isFunctionLike(callback) ||
        callback.async ||
        callback.generator ||
        callback.params.length > OWNED_DOM_SINGLE_COUNT
      ) {
        invalid = true;
        break;
      }
      if (method) {
        if (
          !isNodeOfType(method.definition, "PropertyDefinition") ||
          method.definition.static ||
          definitions.get(method.name)?.length !== OWNED_DOM_SINGLE_COUNT ||
          (writes.get(method.name)?.length ?? OWNED_DOM_EMPTY_COUNT) !== OWNED_DOM_EMPTY_COUNT ||
          !isNodeOfType(callback, "ArrowFunctionExpression")
        ) {
          invalid = true;
          break;
        }
        for (const reference of fieldReferences.filter(
          (reference) => fieldName(reference) === method.name,
        )) {
          const value = findTransparentExpressionRoot(reference);
          const parent = value.parent;
          const attribute = isNodeOfType(parent, "JSXExpressionContainer") ? parent.parent : null;
          if (
            !isNodeOfType(attribute, "JSXAttribute") ||
            !isNodeOfType(attribute.name, "JSXIdentifier") ||
            !isEventHandlerName(attribute.name.name) ||
            findEnclosingClass(attribute) !== classNode
          )
            invalid = true;
        }
      }
      if (
        binding &&
        !binding.references.every((reference) => {
          if (!isRuntimeRead(reference.identifier)) return true;
          const value = findTransparentExpressionRoot(reference.identifier);
          const parent = value.parent;
          const attribute = isNodeOfType(parent, "JSXExpressionContainer") ? parent.parent : null;
          return (
            isNodeOfType(attribute, "JSXAttribute") &&
            isNodeOfType(attribute.name, "JSXIdentifier") &&
            isEventHandlerName(attribute.name.name) &&
            findEnclosingClass(attribute) === classNode
          );
        })
      )
        invalid = true;
      const checkedTargetAliases = new Set<SymbolDescriptor>();
      const targetRead = (rawValue: EsTreeNode): boolean => {
        const value = findTransparentExpressionRoot(rawValue);
        const parent = value.parent;
        if (!parent) return false;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === value &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const symbol = module.scopes.symbolFor(parent.id);
          if (!symbol || !isReadonly(symbol, module)) return false;
          if (checkedTargetAliases.has(symbol)) return true;
          checkedTargetAliases.add(symbol);
          return symbol.references.every(
            (reference) => !isRuntimeRead(reference.identifier) || targetRead(reference.identifier),
          );
        }
        return (
          (isNodeOfType(parent, "BinaryExpression") && ["===", "!=="].includes(parent.operator)) ||
          (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") ||
          (isNodeOfType(parent, "IfStatement") && parent.test === value) ||
          (isNodeOfType(parent, "LogicalExpression") &&
            parent.operator === "&&" &&
            parent.left === value)
        );
      };
      const checkedObjectAliases = new Set<SymbolDescriptor>();
      const objectRead = (rawValue: EsTreeNode): boolean => {
        const value = findTransparentExpressionRoot(rawValue);
        const parent = value.parent;
        if (!parent) return false;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === value &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const symbol = module.scopes.symbolFor(parent.id);
          if (!symbol || !isReadonly(symbol, module)) return false;
          if (checkedObjectAliases.has(symbol)) return true;
          checkedObjectAliases.add(symbol);
          return symbol.references.every(
            (reference) => !isRuntimeRead(reference.identifier) || objectRead(reference.identifier),
          );
        }
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== value ||
          isMemberMutationTarget(parent)
        )
          return false;
        const name = getStaticPropertyKeyName(parent, { allowComputedString: true });
        if (name && OWNED_INPUT_EVENT_SCALAR_NAMES.has(name)) return true;
        if (name === "target" || name === "currentTarget") return targetRead(parent);
        const call = findTransparentExpressionRoot(parent).parent;
        return (
          name === "preventDefault" &&
          isNodeOfType(call, "CallExpression") &&
          !call.optional &&
          call.callee === findTransparentExpressionRoot(parent) &&
          call.arguments.length === OWNED_DOM_EMPTY_COUNT
        );
      };
      const parameter = callback.params[OWNED_DOM_EMPTY_COUNT];
      if (parameter) {
        if (isNodeOfType(parameter, "Identifier")) {
          const symbol = module.scopes.symbolFor(parameter);
          if (
            !symbol ||
            !isReadonly(symbol, module) ||
            !symbol.references.every(
              (reference) =>
                !isRuntimeRead(reference.identifier) || objectRead(reference.identifier),
            )
          )
            invalid = true;
        } else if (isNodeOfType(parameter, "ObjectPattern")) {
          for (const property of parameter.properties) {
            const name = getStaticPropertyKeyName(property, { allowComputedString: true });
            if (
              !isNodeOfType(property, "Property") ||
              property.computed ||
              !isNodeOfType(property.value, "Identifier") ||
              !name
            ) {
              invalid = true;
              break;
            }
            const symbol = module.scopes.symbolFor(property.value);
            if (!symbol || !isReadonly(symbol, module)) {
              invalid = true;
              break;
            }
            if (name === "target" || name === "currentTarget") {
              if (
                !symbol.references.every(
                  (reference) =>
                    !isRuntimeRead(reference.identifier) || targetRead(reference.identifier),
                )
              )
                invalid = true;
            } else if (!OWNED_INPUT_EVENT_SCALAR_NAMES.has(name)) invalid = true;
          }
        } else invalid = true;
      }
      walkAst(callback, (node) => {
        if (
          isNodeOfType(node, "Identifier") &&
          module.scopes.referenceFor(node) &&
          (node.name === "arguments" ||
            (node.name === "event" && module.scopes.isGlobalReference(node)))
        )
          invalid = true;
        if (
          findEnclosingClass(callback) !== classNode &&
          (isNodeOfType(node, "ThisExpression") ||
            isNodeOfType(node, "Super") ||
            isNodeOfType(node, "MetaProperty"))
        )
          invalid = true;
      });
    }
    const receiverMethods = new Set<OwnedDomMethod>();
    for (const reference of fieldReferences) {
      if (!fields.has(fieldName(reference) ?? "")) continue;
      let ancestor: EsTreeNode | null | undefined = reference.parent;
      while (ancestor && ancestor !== classNode) {
        const owner = [...methods.values()].find((method) => method.callback === ancestor);
        if (owner) {
          receiverMethods.add(owner);
          break;
        }
        ancestor = ancestor.parent;
      }
    }
    for (const method of receiverMethods) {
      if (keyMethods.has(method.name)) continue;
      if (
        definitions.get(method.name)?.length !== OWNED_DOM_SINGLE_COUNT ||
        (writes.get(method.name)?.length ?? OWNED_DOM_EMPTY_COUNT) !== OWNED_DOM_EMPTY_COUNT
      ) {
        invalid = true;
        break;
      }
      for (const reference of fieldReferences.filter(
        (reference) => fieldName(reference) === method.name,
      )) {
        const root = findTransparentExpressionRoot(reference);
        const parent = root.parent;
        if (!isNodeOfType(parent, "CallExpression") || parent.optional || parent.callee !== root) {
          invalid = true;
          break;
        }
      }
    }
    if (invalid) continue;
    for (const listener of listenerRoots)
      if (keyMethods.has(listener.name)) listeners.add(listener.call);
    if (!fields.size && !classApproved.size && !listeners.size) continue;
    for (const node of classApproved) approvedNativeUseNodes.add(node);
    for (const call of listeners) approvedListenerCalls.add(call);
  }
  return { approvedNativeUseNodes, approvedListenerCalls };
};
