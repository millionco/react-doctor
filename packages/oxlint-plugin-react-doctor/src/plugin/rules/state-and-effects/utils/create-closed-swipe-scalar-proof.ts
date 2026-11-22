import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getExecutableValueReferences } from "../../../utils/get-executable-value-references.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

type Kind =
  | "number"
  | "string"
  | "boolean"
  | "sample"
  | "samples"
  | "event"
  | "touches"
  | "touch"
  | "state-ref"
  | "state";
type Environment = ReadonlyMap<SymbolDescriptor, Kind>;
export interface ClosedSwipeScalarProof {
  readonly stateRef: SymbolDescriptor;
  readonly verifiedLocalHelpers: ReadonlySet<EsTreeNode>;
  readonly primitiveKind: (
    expression: EsTreeNode,
    handler: EsTreeNode,
  ) => "number" | "string" | null;
}
const primitive = (kind: Kind | null): boolean =>
  kind === "number" || kind === "string" || kind === "boolean";
const readOnly = (symbol: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes) &&
  getExecutableValueReferences(symbol).every((reference) => reference.flag === "read");
const objectFields = (node: EsTreeNode): Map<string, EsTreeNode> | null => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of expression.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.key, "Identifier") ||
      fields.has(property.key.name) ||
      property.key.name === "__proto__"
    )
      return null;
    fields.set(property.key.name, property.value);
  }
  return fields;
};

/** Narrow numeric swipe-state/sample proof. No generic callback inference.
 * Returned primitiveKind is suitable for the separate native-event relay reader. */
export const createClosedSwipeScalarProof = (
  hook: EsTreeNode,
  listeners: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): ClosedSwipeScalarProof | null => {
  if (
    !isFunctionLike(hook) ||
    !isNodeOfType(hook.body, "BlockStatement") ||
    !listeners.length ||
    someAst(
      scopes.rootScope.node,
      (node) =>
        (isNodeOfType(node, "Identifier") && ["eval", "arguments"].includes(node.name)) ||
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "MemberExpression") &&
          ["constructor", "prototype"].includes(getStaticPropertyName(node) ?? "")),
    )
  )
    return null;
  const eventSymbols = new Set<SymbolDescriptor>();
  for (const listener of listeners) {
    if (
      !isNodeOfType(listener, "ArrowFunctionExpression") ||
      listener.async ||
      listener.params.length !== 1 ||
      !isNodeOfType(listener.params[0], "Identifier")
    )
      return null;
    const symbol = scopes.symbolFor(listener.params[0]);
    if (!symbol || !readOnly(symbol, scopes)) return null;
    eventSymbols.add(symbol);
  }
  const candidates: SymbolDescriptor[] = [];
  for (const statement of hook.body.body) {
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") continue;
    for (const declaration of statement.declarations) {
      if (
        !isNodeOfType(declaration.id, "Identifier") ||
        !declaration.init ||
        !isNodeOfType(declaration.init, "CallExpression") ||
        declaration.init.optional ||
        declaration.init.arguments.length !== 1
      )
        continue;
      const api = resolveImportedApiReference(declaration.init.callee, scopes);
      const fields = objectFields(declaration.init.arguments[0]);
      if (
        api?.source !== "react" ||
        api.importedName !== "useRef" ||
        !fields ||
        fields.size !== 4 ||
        !["swiping", "startX", "startY", "samples"].every((key) => fields.has(key))
      )
        continue;
      const swiping = stripParenExpression(fields.get("swiping")!);
      const x = stripParenExpression(fields.get("startX")!);
      const y = stripParenExpression(fields.get("startY")!);
      const samples = stripParenExpression(fields.get("samples")!);
      const symbol = scopes.symbolFor(declaration.id);
      if (
        symbol &&
        isNodeOfType(swiping, "Literal") &&
        swiping.value === false &&
        isNodeOfType(x, "Literal") &&
        x.value === 0 &&
        isNodeOfType(y, "Literal") &&
        y.value === 0 &&
        isNodeOfType(samples, "ArrayExpression") &&
        samples.elements.length === 0 &&
        readOnly(symbol, scopes)
      )
        candidates.push(symbol);
    }
  }
  if (candidates.length !== 1) return null;
  const stateRef = candidates[0];
  const verifiedLocalHelpers = new Set<EsTreeNode>();
  const activeFunctions = new Set<EsTreeNode>();
  const kind = (
    raw: EsTreeNode,
    environment: Environment = new Map(),
    seen = new Set<SymbolDescriptor>(),
    depth = 0,
  ): Kind | null => {
    if (depth > 32) return null;
    const node = stripParenExpression(raw);
    const read = (value: EsTreeNode): Kind | null => kind(value, environment, seen, depth + 1);
    if (isNodeOfType(node, "Literal")) {
      if (typeof node.value === "number") return "number";
      if (typeof node.value === "string") return "string";
      if (typeof node.value === "boolean") return "boolean";
      return null;
    }
    if (isNodeOfType(node, "Identifier")) {
      const symbol = scopes.symbolFor(node);
      if (!symbol) return null;
      if (environment.has(symbol)) return environment.get(symbol)!;
      if (eventSymbols.has(symbol)) return "event";
      if (symbol === stateRef) return "state-ref";
      if (seen.has(symbol) || !readOnly(symbol, scopes)) return null;
      const init = getDirectConstInitializer(symbol);
      return init ? kind(init, environment, new Set(seen).add(symbol), depth + 1) : null;
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const receiver = read(node.object);
      const name =
        !node.computed && isNodeOfType(node.property, "Identifier") ? node.property.name : null;
      if (receiver === "state-ref" && name === "current") return "state";
      if (receiver === "state") {
        if (name === "startX" || name === "startY") return "number";
        if (name === "swiping") return "boolean";
        if (name === "samples") return "samples";
      }
      if (receiver === "event" && (name === "touches" || name === "changedTouches"))
        return "touches";
      if (
        receiver === "touches" &&
        node.computed &&
        isNodeOfType(node.property, "Literal") &&
        node.property.value === 0
      )
        return "touch";
      if (receiver === "touch" && (name === "clientX" || name === "clientY")) return "number";
      if (receiver === "samples") {
        if (name === "length") return "number";
        if (node.computed && read(node.property) === "number") return "sample";
      }
      if (receiver === "sample" && ["x", "y", "time"].includes(name ?? "")) return "number";
      return null;
    }
    if (isNodeOfType(node, "ArrayExpression")) {
      return node.elements.every(
        (value) => value && !isNodeOfType(value, "SpreadElement") && read(value) === "sample",
      )
        ? "samples"
        : null;
    }
    if (isNodeOfType(node, "ObjectExpression")) {
      const fields = objectFields(node);
      return fields?.size === 3 &&
        ["x", "y", "time"].every((key) => fields.has(key) && read(fields.get(key)!) === "number")
        ? "sample"
        : null;
    }
    if (isNodeOfType(node, "UnaryExpression")) {
      const operand = read(node.argument);
      if (node.operator === "!" && primitive(operand)) return "boolean";
      return ["+", "-", "~"].includes(node.operator) && operand === "number" ? "number" : null;
    }
    if (isNodeOfType(node, "BinaryExpression")) {
      const left = read(node.left),
        right = read(node.right);
      if (["+", "-", "*", "/", "%", "**"].includes(node.operator))
        return left === "number" && right === "number" ? "number" : null;
      return ["<", "<=", ">", ">=", "===", "!=="].includes(node.operator) &&
        primitive(left) &&
        primitive(right)
        ? "boolean"
        : null;
    }
    if (isNodeOfType(node, "LogicalExpression")) {
      const left = read(node.left),
        right = read(node.right);
      return left === right && primitive(left) ? left : null;
    }
    if (isNodeOfType(node, "ConditionalExpression")) {
      const left = read(node.consequent),
        right = read(node.alternate);
      return primitive(read(node.test)) && left === right && primitive(left) ? left : null;
    }
    if (
      !isNodeOfType(node, "CallExpression") ||
      node.optional ||
      node.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return null;
    const callee = stripParenExpression(node.callee);
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      !callee.optional &&
      isNodeOfType(callee.property, "Identifier")
    ) {
      const method = callee.property.name;
      if (
        ["abs", "sqrt", "max", "min"].includes(method) &&
        node.arguments.length > 0 &&
        isProvenUnmodifiedGlobalNamespaceReference(callee.object, "Math", scopes, method, true) &&
        node.arguments.every((argument) => read(argument) === "number")
      )
        return "number";
      if (
        method === "now" &&
        node.arguments.length === 0 &&
        isProvenUnmodifiedGlobalNamespaceReference(callee.object, "Date", scopes, method, true)
      )
        return "number";
    }
    if (!isNodeOfType(callee, "Identifier")) return null;
    const binding = scopes.symbolFor(callee);
    const fn = binding?.initializer;
    if (
      !binding ||
      !readOnly(binding, scopes) ||
      !fn ||
      !isFunctionLike(fn) ||
      fn.async ||
      ((isNodeOfType(fn, "FunctionDeclaration") || isNodeOfType(fn, "FunctionExpression")) &&
        fn.generator) ||
      activeFunctions.has(fn) ||
      fn.params.length !== node.arguments.length
    )
      return null;
    const inner = new Map(environment);
    for (let index = 0; index < fn.params.length; index++) {
      const parameter = fn.params[index];
      const argumentKind = read(node.arguments[index]);
      if (
        !isNodeOfType(parameter, "Identifier") ||
        !argumentKind ||
        (!primitive(argumentKind) && argumentKind !== "samples")
      )
        return null;
      const symbol = scopes.symbolFor(parameter);
      if (!symbol || !readOnly(symbol, scopes)) return null;
      inner.set(symbol, argumentKind);
    }
    const returns: Kind[] = [];
    const statements = (list: ReadonlyArray<EsTreeNode>): boolean => {
      for (const statement of list) {
        if (isNodeOfType(statement, "ReturnStatement")) {
          const value = statement.argument && kind(statement.argument, inner, new Set(), depth + 1);
          if (!value || !primitive(value)) return false;
          returns.push(value);
          continue;
        }
        if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
          for (const declaration of statement.declarations) {
            if (
              !isNodeOfType(declaration.id, "Identifier") ||
              !declaration.init ||
              !kind(declaration.init, inner, new Set(), depth + 1)
            )
              return false;
            const symbol = scopes.symbolFor(declaration.id);
            if (!symbol || !readOnly(symbol, scopes)) return false;
          }
          continue;
        }
        if (
          !isNodeOfType(statement, "IfStatement") ||
          !primitive(kind(statement.test, inner, new Set(), depth + 1))
        )
          return false;
        const consequent = isNodeOfType(statement.consequent, "BlockStatement")
          ? statement.consequent.body
          : [statement.consequent];
        if (!statements(consequent)) return false;
        if (
          statement.alternate &&
          !statements(
            isNodeOfType(statement.alternate, "BlockStatement")
              ? statement.alternate.body
              : [statement.alternate],
          )
        )
          return false;
      }
      return true;
    };
    activeFunctions.add(fn);
    let accepted = false;
    if (isNodeOfType(fn.body, "BlockStatement")) {
      accepted = isNodeOfType(fn.body.body.at(-1), "ReturnStatement") && statements(fn.body.body);
    } else {
      const value = kind(fn.body, inner, new Set(), depth + 1);
      if (value && primitive(value)) {
        returns.push(value);
        accepted = true;
      }
    }
    activeFunctions.delete(fn);
    if (!accepted || !returns.length || returns.some((value) => value !== returns[0])) return null;
    verifiedLocalHelpers.add(fn);
    return returns[0];
  };

  for (const reference of getExecutableValueReferences(stateRef)) {
    const current = reference.identifier.parent;
    const declaration = current?.parent;
    if (
      !isNodeOfType(current, "MemberExpression") ||
      current.computed ||
      current.optional ||
      !isNodeOfType(current.property, "Identifier") ||
      current.property.name !== "current" ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.init !== current ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !listeners.includes(findEnclosingFunction(declaration)!)
    )
      return null;
    const alias = scopes.symbolFor(declaration.id);
    if (!alias || !getDirectConstInitializer(alias) || !readOnly(alias, scopes)) return null;
    for (const use of getExecutableValueReferences(alias)) {
      const field = use.identifier.parent;
      if (
        !isNodeOfType(field, "MemberExpression") ||
        field.object !== use.identifier ||
        field.computed ||
        field.optional ||
        !isNodeOfType(field.property, "Identifier")
      )
        return null;
      const name = field.property.name;
      if (!["startX", "startY", "swiping", "samples"].includes(name)) return null;
      const consumer = field.parent;
      if (isWithinAssignmentTarget(field)) {
        if (
          !isNodeOfType(consumer, "AssignmentExpression") ||
          consumer.left !== field ||
          consumer.operator !== "="
        )
          return null;
        const wanted = name === "samples" ? "samples" : name === "swiping" ? "boolean" : "number";
        if (kind(consumer.right) !== wanted) return null;
      } else if (name === "samples") {
        if (
          isNodeOfType(consumer, "MemberExpression") &&
          !consumer.computed &&
          isNodeOfType(consumer.property, "Identifier") &&
          ["push", "shift"].includes(consumer.property.name)
        ) {
          const call = consumer.parent;
          if (
            !isNodeOfType(call, "CallExpression") ||
            call.optional ||
            call.callee !== consumer ||
            !isNodeOfType(call.parent, "ExpressionStatement") ||
            (consumer.property.name === "push"
              ? call.arguments.length !== 1 || kind(call.arguments[0]) !== "sample"
              : call.arguments.length !== 0)
          )
            return null;
        } else if (isNodeOfType(consumer, "CallExpression")) {
          if (
            !consumer.arguments.some((argument) => argument === field) ||
            !primitive(kind(consumer))
          )
            return null;
        } else {
          let outer: EsTreeNode = field;
          while (isNodeOfType(outer.parent, "MemberExpression") && outer.parent.object === outer)
            outer = outer.parent;
          if (!primitive(kind(outer))) return null;
        }
      }
    }
  }
  return {
    stateRef,
    verifiedLocalHelpers,
    primitiveKind(expression, handler) {
      if (!listeners.includes(handler) || findEnclosingFunction(expression) !== handler)
        return null;
      const value = kind(expression);
      return value === "number" || value === "string" ? value : null;
    },
  };
};

export const createSwipeRelayPrimitiveKind = (
  hook: EsTreeNode,
  listeners: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): ((expression: EsTreeNode, handler: EsTreeNode) => "number" | "string" | null) | null =>
  createClosedSwipeScalarProof(hook, listeners, scopes)?.primitiveKind ?? null;
