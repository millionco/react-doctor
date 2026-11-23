import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

type Scalar = "string" | "number" | "boolean" | "null" | "regex";
type Shape =
  | Scalar
  | "data"
  | "void"
  | "build"
  | "compiler"
  | "span"
  | "output"
  | "filesystem"
  | { readonly item: Shape }
  | { readonly setItem: Shape }
  | { readonly fields: Readonly<Record<string, Shape>> };
type Env = Map<number, Shape>;
type FunctionNode = EsTreeNodeOfType<
  "FunctionDeclaration" | "ArrowFunctionExpression" | "FunctionExpression"
>;

const array = (item: Shape): Shape => ({ item });
const record = (fields: Readonly<Record<string, Shape>>): Shape => ({ fields });
const arrayItem = (shape: Shape): Shape | null =>
  typeof shape === "object" && "item" in shape ? shape.item : null;
const builtinEvent = record({
  name: "string",
  complexType: record({ resolved: "string" }),
  docs: record({ text: "string" }),
});
const buildComponents = array(record({ tagName: "string", events: array(builtinEvent) }));
const TEXT_VALUES = new Set<Shape>(["string", "number", "boolean"]);
const authorityValues = new Set<Shape>([
  "void",
  "build",
  "compiler",
  "output",
  "span",
  "filesystem",
]);
const unsafeKey = (key: string) => ["__proto__", "constructor", "prototype"].includes(key);

function merge(left: Shape, right: Shape): Shape {
  if (left === right) return left;
  if (typeof left === "object" && typeof right === "object") {
    if ("item" in left && "item" in right) return array(merge(left.item, right.item));
    if ("fields" in left && "fields" in right) {
      const common: Record<string, Shape> = Object.create(null);
      for (const [key, type] of Object.entries(left.fields))
        if (Object.hasOwn(right.fields, key)) common[key] = merge(type, right.fields[key]);
      return record(common);
    }
  }
  return "data";
}

function inputField(type: Shape, key: string): Shape | null {
  if (type === "build") return key === "components" ? buildComponents : null;
  if (type === "compiler") return key === "fs" ? "filesystem" : null;
  if (type === "output") return ["tsPath", "mdPath", "footer"].includes(key) ? "string" : null;
  return typeof type === "object" && "fields" in type && Object.hasOwn(type.fields, key)
    ? type.fields[key]
    : null;
}

// Source-level proof under separately verified compiler/provider contracts:
// component/event metadata and time spans are stock compiler values, and the
// installed formatter and native builtins have their documented behavior.
export const isBoundedStencilOutputGenerator = (
  program: EsTreeNodeOfType<"Program">,
  generator: EsTreeNodeOfType<"FunctionExpression">,
  outputParameter: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let operations = 0;
  const depthLimit = 48;
  const budget = () => ++operations <= 6000;
  const topLevelFunctions = new Set<EsTreeNode>();
  const bound = (node: EsTreeNode) => scopes.symbolFor(node)?.id;
  const global = (node: EsTreeNode, name: string) =>
    isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);

  function invoke(fn: FunctionNode, args: readonly Shape[], env: Env, depth: number): Shape | null {
    if (
      depth > depthLimit ||
      !budget() ||
      fn.params.length !== args.length ||
      ("generator" in fn && fn.generator) ||
      (fn !== generator && fn.async)
    )
      return null;
    const local = new Map(env);
    for (const [index, param] of fn.params.entries()) {
      if (!isNodeOfType(param, "Identifier")) return null;
      const id = bound(param);
      if (id === undefined) return null;
      local.set(id, args[index]);
    }
    if (!isNodeOfType(fn.body, "BlockStatement")) {
      const result = infer(fn.body, local, depth + 1);
      return result && !authorityValues.has(result) ? result : null;
    }
    const returns: Shape[] = [];
    if (!steps(fn.body, local, depth + 1, returns)) return null;
    return returns.length ? returns.reduce(merge) : "void";
  }

  function letConst(node: EsTreeNode, env: Env, depth: number): boolean {
    if (!isNodeOfType(node, "VariableDeclaration") || node.kind !== "const") return false;
    for (const declaration of node.declarations) {
      if (!isNodeOfType(declaration.id, "Identifier") || !declaration.init) return false;
      const id = bound(declaration.id);
      const value = infer(declaration.init, env, depth + 1);
      if (
        id === undefined ||
        !value ||
        (value !== "span" && authorityValues.has(value)) ||
        (value === "span" &&
          !isNodeOfType(stripParenExpression(declaration.init), "CallExpression"))
      )
        return false;
      env.set(id, value);
    }
    return true;
  }

  function steps(node: EsTreeNode, env: Env, depth: number, returns: Shape[]): boolean {
    if (depth > depthLimit || !budget()) return false;
    if (isNodeOfType(node, "BlockStatement")) {
      const local = new Map(env);
      return node.body.every((statement) => steps(statement, local, depth + 1, returns));
    }
    if (isNodeOfType(node, "VariableDeclaration")) return letConst(node, env, depth);
    if (isNodeOfType(node, "IfStatement"))
      return (
        infer(node.test, env, depth + 1) === "boolean" &&
        steps(node.consequent, new Map(env), depth + 1, returns) &&
        (!node.alternate || steps(node.alternate, new Map(env), depth + 1, returns))
      );
    if (isNodeOfType(node, "ReturnStatement")) {
      if (!node.argument) return false;
      const value = infer(node.argument, env, depth + 1);
      if (!value || authorityValues.has(value)) return false;
      returns.push(value);
      return true;
    }
    return (
      isNodeOfType(node, "ExpressionStatement") && infer(node.expression, env, depth + 1) === "void"
    );
  }

  function call(node: EsTreeNodeOfType<"CallExpression">, env: Env, depth: number): Shape | null {
    if (node.optional) return null;
    const { callee } = node;
    const expression = (item: EsTreeNode) => infer(item, env, depth + 1);
    if (isNodeOfType(callee, "Identifier")) {
      const symbol = scopes.symbolFor(callee);
      if (!symbol) return null;
      const local = symbol.declarationNode;
      const inputs = node.arguments.map(expression);
      if (inputs.some((value) => value === null || authorityValues.has(value))) return null;
      if (isNodeOfType(local, "FunctionDeclaration") && topLevelFunctions.has(local))
        return invoke(local, inputs as Shape[], env, depth + 1);
      const declaration = getImportDeclarationForSymbol(symbol);
      const binding = symbol.declarationNode;
      if (
        declaration?.source.value === "json2md" &&
        declaration.importKind !== "type" &&
        isNodeOfType(binding, "ImportDefaultSpecifier") &&
        inputs.length >= 1 &&
        inputs.length <= 3 &&
        arrayItem(inputs[0] as Shape) !== null &&
        inputs.slice(1).every((value) => value === "string")
      )
        return "string";
      return null;
    }
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      callee.optional ||
      !isNodeOfType(callee.property, "Identifier")
    )
      return null;
    const method = callee.property.name;
    const receiver = expression(callee.object);
    if (!receiver) return null;
    const item = arrayItem(receiver);
    if (item && ["map", "flatMap", "findIndex"].includes(method)) {
      const [callback] = node.arguments;
      if (node.arguments.length !== 1 || !isNodeOfType(callback, "ArrowFunctionExpression"))
        return null;
      const value = invoke(callback, [item], env, depth + 1);
      if (!value || value === "void") return null;
      if (method === "map") return array(value);
      if (method === "flatMap") return arrayItem(value) ? value : null;
      return value === "boolean" ? "number" : null;
    }
    const args = node.arguments.map(expression);
    if (args.some((value) => value === null)) return null;
    if (item && method === "slice" && args.length <= 2 && args.every((value) => value === "number"))
      return receiver;
    if (
      item &&
      method === "join" &&
      TEXT_VALUES.has(item) &&
      args.length === 1 &&
      args[0] === "string"
    )
      return "string";
    if (
      receiver === "string" &&
      method === "replaceAll" &&
      args.length === 2 &&
      (args[0] === "string" || args[0] === "regex") &&
      args[1] === "string"
    )
      return "string";
    if (
      receiver === "build" &&
      method === "createTimeSpan" &&
      args.length === 2 &&
      args[0] === "string" &&
      args[1] === "boolean"
    )
      return "span";
    if (receiver === "span" && method === "finish" && args.length === 1 && args[0] === "string")
      return "void";
    if (
      receiver === "filesystem" &&
      method === "writeFile" &&
      args.length === 2 &&
      args[0] === "string" &&
      args[1] === "string"
    )
      return "void";
    return null;
  }

  function infer(start: EsTreeNode, env: Env, depth: number): Shape | null {
    if (depth > depthLimit || !budget()) return null;
    const node = stripParenExpression(start);
    const expression = (item: EsTreeNode) => infer(item, env, depth + 1);
    if (isNodeOfType(node, "Literal")) {
      if ("regex" in node) return "regex";
      if (node.value === null) return "null";
      switch (typeof node.value) {
        case "string":
          return "string";
        case "number":
          return "number";
        case "boolean":
          return "boolean";
        default:
          return null;
      }
    }
    if (isNodeOfType(node, "Identifier")) {
      const id = bound(node);
      return id === undefined ? null : (env.get(id) ?? null);
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      !node.computed &&
      !node.optional &&
      isNodeOfType(node.property, "Identifier")
    ) {
      const parent = expression(node.object);
      return parent ? inputField(parent, node.property.name) : null;
    }
    if (isNodeOfType(node, "ArrayExpression")) {
      let combined: Shape | null = null;
      for (const element of node.elements) {
        if (!element) return null;
        const value = isNodeOfType(element, "SpreadElement")
          ? expression(element.argument)
          : expression(element);
        const next =
          value && isNodeOfType(element, "SpreadElement")
            ? typeof value === "object" && "setItem" in value
              ? value.setItem
              : arrayItem(value)
            : value;
        if (!next || authorityValues.has(next)) return null;
        combined = combined ? merge(combined, next) : next;
      }
      return array(combined ?? "data");
    }
    if (isNodeOfType(node, "ObjectExpression")) {
      const fields: Record<string, Shape> = Object.create(null);
      for (const property of node.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          property.computed ||
          property.method ||
          property.kind !== "init"
        )
          return null;
        const key = isNodeOfType(property.key, "Identifier")
          ? property.key.name
          : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
            ? property.key.value
            : null;
        const value = expression(property.value);
        if (
          key === null ||
          unsafeKey(key) ||
          Object.hasOwn(fields, key) ||
          !value ||
          authorityValues.has(value)
        )
          return null;
        fields[key] = value;
      }
      return record(fields);
    }
    if (isNodeOfType(node, "TemplateLiteral"))
      return node.expressions.every((item) => {
        const value = expression(item);
        return value !== null && TEXT_VALUES.has(value);
      })
        ? "string"
        : null;
    if (
      isNodeOfType(node, "TaggedTemplateExpression") &&
      isNodeOfType(node.tag, "MemberExpression") &&
      !node.tag.computed &&
      !node.tag.optional &&
      global(node.tag.object, "String") &&
      isNodeOfType(node.tag.property, "Identifier") &&
      node.tag.property.name === "raw"
    )
      return expression(node.quasi);
    if (
      isNodeOfType(node, "NewExpression") &&
      global(node.callee, "Set") &&
      node.arguments.length === 1
    ) {
      const input = expression(node.arguments[0]);
      return input && arrayItem(input) === "string" ? { setItem: "string" } : null;
    }
    if (isNodeOfType(node, "CallExpression")) return call(node, env, depth);
    if (isNodeOfType(node, "AwaitExpression"))
      return expression(node.argument) === "void" ? "void" : null;
    if (
      isNodeOfType(node, "UnaryExpression") &&
      node.operator === "-" &&
      expression(node.argument) === "number"
    )
      return "number";
    if (isNodeOfType(node, "BinaryExpression")) {
      const left = expression(node.left);
      const right = expression(node.right);
      if (left === null || right === null) return null;
      if (node.operator === "+" && left === "number" && right === "number") return "number";
      if (node.operator === "===" && TEXT_VALUES.has(left) && TEXT_VALUES.has(right))
        return "boolean";
      return null;
    }
    if (
      isNodeOfType(node, "LogicalExpression") &&
      node.operator === "||" &&
      expression(node.left) === "string" &&
      expression(node.right) === "string"
    )
      return "string";
    return null;
  }

  const top = new Map<number, Shape>();
  for (const statement of program.body) {
    if (isNodeOfType(statement, "FunctionDeclaration") && statement.id)
      topLevelFunctions.add(statement);
    if (isNodeOfType(statement, "VariableDeclaration") && !letConst(statement, top, 0))
      return false;
  }
  const output = bound(outputParameter);
  return (
    output !== undefined &&
    invoke(generator, ["data", "compiler", "build"], new Map(top).set(output, "output"), 0) ===
      "void"
  );
};
