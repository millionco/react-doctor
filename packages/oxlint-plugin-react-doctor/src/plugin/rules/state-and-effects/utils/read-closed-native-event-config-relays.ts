import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getExecutableValueReferences } from "../../../utils/get-executable-value-references.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export interface NativeEventRelayScalarProofs {
  // No permissive default. Must resolve actual arithmetic/local helper values,
  // not infer scalar type from TypeScript, a name, or an arbitrary call.
  readonly primitiveKind: (
    expression: EsTreeNode,
    handler: EsTreeNode,
  ) => "number" | "string" | null;
}
export interface ClosedNativeEventConfigRelay {
  readonly configField: "onSwiping" | "onSwiped";
  readonly configParameter: SymbolDescriptor;
  readonly handler: EsTreeNode;
  readonly eventParameter: SymbolDescriptor;
  readonly call: EsTreeNodeOfType<"CallExpression">;
  readonly eventField: "event";
}
const refs = getExecutableValueReferences;
const ordinaryMember = (
  node: EsTreeNode,
  key: string,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === key;
const readonly = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  refs(symbol).every((reference) => reference.flag === "read");
const fields = (node: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression") && !isNodeOfType(node, "ObjectPattern")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.key, "Identifier") ||
      property.key.name === "__proto__" ||
      result.has(property.key.name)
    )
      return null;
    result.set(property.key.name, property.value);
  }
  return result;
};
const same = (node: EsTreeNode, symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;
const onlyCoordinateReads = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  readonly(symbol, scopes) &&
  refs(symbol).every(({ identifier }) => {
    const root = findTransparentExpressionRoot(identifier);
    const parent = root.parent;
    return (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === root &&
      !parent.computed &&
      isNodeOfType(parent.property, "Identifier") &&
      ["clientX", "clientY"].includes(parent.property.name)
    );
  });
const isTouchCoordinatePath = (event: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const root = findTransparentExpressionRoot(event);
  const list = root.parent;
  const indexed = list?.parent;
  if (
    !list ||
    (!ordinaryMember(list, "touches") && !ordinaryMember(list, "changedTouches")) ||
    list.object !== root ||
    !isNodeOfType(indexed, "MemberExpression") ||
    indexed.object !== list ||
    !indexed.computed ||
    indexed.optional ||
    !isNodeOfType(indexed.property, "Literal") ||
    indexed.property.value !== 0
  )
    return false;
  const outer = findTransparentExpressionRoot(indexed);
  const consumer = outer.parent;
  if (
    isNodeOfType(consumer, "MemberExpression") &&
    consumer.object === outer &&
    !consumer.computed &&
    isNodeOfType(consumer.property, "Identifier") &&
    ["clientX", "clientY"].includes(consumer.property.name)
  )
    return true;
  if (
    !isNodeOfType(consumer, "VariableDeclarator") ||
    consumer.init !== outer ||
    !isNodeOfType(consumer.id, "Identifier")
  )
    return false;
  const symbol = scopes.symbolFor(consumer.id);
  return Boolean(
    symbol && getDirectConstInitializer(symbol) === outer && onlyCoordinateReads(symbol, scopes),
  );
};

/** Closes only native event -> private config callback relay. Source provider,
 * listener registration and callback consumers are independent obligations. */
export const readClosedNativeEventConfigRelays = (
  hook: EsTreeNode,
  listeners: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
  proofs: NativeEventRelayScalarProofs,
): ReadonlyArray<ClosedNativeEventConfigRelay> | null => {
  if (
    !isNodeOfType(hook, "FunctionDeclaration") ||
    hook.async ||
    hook.generator ||
    !isNodeOfType(hook.body, "BlockStatement") ||
    hook.params.length !== 1 ||
    !isNodeOfType(hook.params[0], "ObjectPattern") ||
    !listeners.length ||
    new Set(listeners).size !== listeners.length ||
    someAst(
      hook,
      (node) =>
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") && ["eval", "arguments"].includes(node.name)),
    )
  )
    return null;
  const parameters = fields(hook.params[0]);
  const onSwiping = parameters?.get("onSwiping");
  const onSwiped = parameters?.get("onSwiped");
  if (
    !parameters ||
    parameters.size !== 3 ||
    !parameters.has("delta") ||
    !isNodeOfType(onSwiping, "Identifier") ||
    !isNodeOfType(onSwiped, "Identifier")
  )
    return null;
  const configParams = new Map<string, SymbolDescriptor>();
  for (const [key, raw] of parameters) {
    let value = raw;
    if (
      key === "delta" &&
      isNodeOfType(raw, "AssignmentPattern") &&
      isNodeOfType(raw.right, "Literal") &&
      raw.right.value === 0
    )
      value = raw.left;
    if (!isNodeOfType(value, "Identifier")) return null;
    const symbol = scopes.symbolFor(value);
    if (!symbol || !readonly(symbol, scopes)) return null;
    configParams.set(key, symbol);
  }
  const relays: ClosedNativeEventConfigRelay[] = [];
  let config: SymbolDescriptor | null = null;
  const configReads: EsTreeNode[] = [];
  for (const handler of listeners) {
    if (
      !isNodeOfType(handler, "ArrowFunctionExpression") ||
      handler.async ||
      handler.params.length !== 1 ||
      !isNodeOfType(handler.params[0], "Identifier")
    )
      return null;
    const event = scopes.symbolFor(handler.params[0]);
    if (!event || !readonly(event, scopes)) return null;
    for (const reference of refs(event)) {
      if (findEnclosingFunction(reference.identifier) !== handler) return null;
      if (isTouchCoordinatePath(reference.identifier, scopes)) continue;
      const property = reference.identifier.parent;
      const payload = property?.parent;
      const call = payload?.parent;
      if (
        !isNodeOfType(property, "Property") ||
        property.value !== reference.identifier ||
        property.computed ||
        property.method ||
        property.kind !== "init" ||
        !isNodeOfType(property.key, "Identifier") ||
        property.key.name !== "event" ||
        !isNodeOfType(payload, "ObjectExpression") ||
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.arguments.length !== 1 ||
        call.arguments[0] !== payload ||
        !isNodeOfType(call.callee, "Identifier")
      )
        return null;
      const values = fields(payload);
      if (
        !values ||
        values.size !== 5 ||
        values.get("event") !== reference.identifier ||
        !["absX", "absY", "velocity"].every(
          (key) => values.has(key) && proofs.primitiveKind(values.get(key)!, handler) === "number",
        ) ||
        !values.has("dir") ||
        proofs.primitiveKind(values.get("dir")!, handler) !== "string"
      )
        return null;
      const callback = scopes.symbolFor(call.callee);
      const declaration = callback?.declarationNode;
      if (
        !callback ||
        !readonly(callback, scopes) ||
        !isNodeOfType(declaration, "VariableDeclarator") ||
        !isNodeOfType(declaration.id, "ObjectPattern") ||
        !declaration.init ||
        findEnclosingFunction(declaration) !== handler
      )
        return null;
      const extracted = fields(declaration.id);
      const current = stripParenExpression(declaration.init);
      if (
        !extracted ||
        !ordinaryMember(current, "current") ||
        !isNodeOfType(current.object, "Identifier")
      )
        return null;
      const holder = scopes.symbolFor(current.object);
      if (!holder || (config && config !== holder)) return null;
      config = holder;
      configReads.push(current.object);
      const field = [...extracted].find(([, value]) => value === callback.bindingIdentifier)?.[0];
      if (field !== "onSwiping" && field !== "onSwiped") return null;
      let condition: EsTreeNode | null = null;
      for (const use of refs(callback)) {
        if (use.identifier === call.callee) continue;
        const branch = use.identifier.parent;
        if (
          condition ||
          !isNodeOfType(branch, "IfStatement") ||
          branch.test !== use.identifier ||
          branch.alternate
        )
          return null;
        let ancestor: EsTreeNode | null | undefined = call;
        while (ancestor && ancestor !== branch.consequent) ancestor = ancestor.parent;
        if (ancestor !== branch.consequent) return null;
        condition = use.identifier;
      }
      if (!condition || refs(callback).length !== 2) return null;
      relays.push({
        configField: field,
        configParameter: configParams.get(field)!,
        handler,
        eventParameter: event,
        call,
        eventField: "event",
      });
    }
  }
  if (
    !config ||
    relays.length !== 2 ||
    new Set(relays.map((item) => item.configField)).size !== 2 ||
    !readonly(config, scopes)
  )
    return null;
  const initial = getDirectConstInitializer(config);
  if (
    !isNodeOfType(initial, "CallExpression") ||
    initial.optional ||
    initial.arguments.length !== 1 ||
    !isNodeOfType(initial.callee, "Identifier")
  )
    return null;
  const api = resolveImportedApiReference(initial.callee, scopes);
  if (api?.source !== "react" || api.importedName !== "useRef") return null;
  const matchesConfig = (value: EsTreeNode): boolean => {
    const object = fields(value);
    return Boolean(
      object &&
      object.size === configParams.size &&
      [...configParams].every(
        ([key, symbol]) => object.has(key) && same(object.get(key)!, symbol, scopes),
      ),
    );
  };
  if (!matchesConfig(initial.arguments[0])) return null;
  let update: EsTreeNode | null = null;
  for (const reference of refs(config)) {
    if (configReads.includes(reference.identifier)) continue;
    const current = reference.identifier.parent;
    const assignment = current?.parent;
    if (
      update ||
      !isNodeOfType(current, "MemberExpression") ||
      !ordinaryMember(current, "current") ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== current ||
      !matchesConfig(assignment.right) ||
      !isNodeOfType(assignment.parent, "ExpressionStatement") ||
      assignment.parent.parent !== hook.body
    )
      return null;
    update = reference.identifier;
  }
  if (!update || refs(config).length !== configReads.length + 1) return null;
  for (const symbol of configParams.values()) {
    if (
      refs(symbol).length !== 2 ||
      refs(symbol).some(({ identifier }) => {
        const property = identifier.parent;
        return (
          !isNodeOfType(property, "Property") ||
          property.value !== identifier ||
          (!initial.arguments.some((argument) => argument === property.parent) &&
            !(
              isNodeOfType(property.parent?.parent, "AssignmentExpression") &&
              property.parent.parent.right === property.parent
            ))
        );
      })
    )
      return null;
  }
  return relays;
};
