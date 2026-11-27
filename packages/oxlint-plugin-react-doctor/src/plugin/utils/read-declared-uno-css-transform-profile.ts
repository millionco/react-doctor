import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const stablePresets = ["presetUno", "presetAttributify", "presetIcons"] as const;
const jsxTransformers = [
  "transformerDirectives",
  "transformerVariantGroup",
  "transformerAttributifyJsx",
] as const;
const supportedFields = new Set(["shortcuts", "rules", "presets", "transformers"]);
const primitiveSyntax = new Set([
  "ArrayExpression",
  "ArrayPattern",
  "ArrowFunctionExpression",
  "BinaryExpression",
  "BlockStatement",
  "ConditionalExpression",
  "ExpressionStatement",
  "Identifier",
  "IfStatement",
  "Literal",
  "LogicalExpression",
  "NewExpression",
  "ObjectExpression",
  "Property",
  "ReturnStatement",
  "TemplateElement",
  "TemplateLiteral",
  "UnaryExpression",
  "VariableDeclaration",
  "VariableDeclarator",
  "AssignmentExpression",
  "CallExpression",
  "MemberExpression",
  "ParenthesizedExpression",
]);

const importedName = (callee: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(callee, "Identifier")) return null;
  const ref = resolveImportedApiReference(callee, scopes);
  return ref?.source === "unocss" ? ref.importedName : null;
};
const readFields = (value: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(value, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of value.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      property.shorthand
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (!key || fields.has(key) || ["__proto__", "prototype", "constructor"].includes(key))
      return null;
    fields.set(key, property.value);
  }
  return fields;
};
const isData = (value: EsTreeNode | undefined): boolean => {
  if (isNodeOfType(value, "Literal")) {
    return value.value === null || ["string", "number", "boolean"].includes(typeof value.value);
  }
  if (isNodeOfType(value, "ArrayExpression"))
    return value.elements.every((element) => isData(element ?? undefined));
  if (!value) return false;
  const fields = readFields(value);
  return fields !== null && [...fields.values()].every(isData);
};
const isPrimitiveMethod = (value: EsTreeNode): boolean => {
  if (
    !isNodeOfType(value, "MemberExpression") ||
    value.computed ||
    value.optional ||
    !isNodeOfType(value.property, "Identifier")
  )
    return false;
  const call = value.parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.callee !== value) return false;
  if (value.property.name === "includes") {
    return (
      isNodeOfType(value.object, "ArrayExpression") &&
      isData(value.object) &&
      call.arguments.length === 1
    );
  }
  const primitive = stripParenExpression(value.object);
  return (
    value.property.name === "toString" &&
    isNodeOfType(primitive, "BinaryExpression") &&
    ["-", "*", "/", "%"].includes(primitive.operator) &&
    call.arguments.length === 0
  );
};
const readFactoryArray = (
  node: EsTreeNode | undefined,
  names: readonly string[],
  scopes: ScopeAnalysis,
  dataArguments: boolean,
): boolean =>
  isNodeOfType(node, "ArrayExpression") &&
  node.elements.length === names.length &&
  node.elements.every(
    (item, index) =>
      isNodeOfType(item, "CallExpression") &&
      !item.optional &&
      importedName(item.callee, scopes) === names[index] &&
      (dataArguments
        ? item.arguments.length <= 1 && item.arguments.every(isData)
        : item.arguments.length === 0),
  );

const isInside = (node: EsTreeNode, ancestor: EsTreeNode): boolean => {
  for (let current: EsTreeNode | null | undefined = node; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
};

export const hasStaticUnoCssTransformProfile = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return false;
  const [imports, ...remainder] = program.body;
  if (
    !isNodeOfType(imports, "ImportDeclaration") ||
    imports.importKind === "type" ||
    imports.source.value !== "unocss" ||
    !imports.specifiers.every((specifier) => isNodeOfType(specifier, "ImportSpecifier"))
  )
    return false;
  const exported = remainder.pop();
  if (!isNodeOfType(exported, "ExportDefaultDeclaration")) return false;
  const factory = exported.declaration;
  if (
    !isNodeOfType(factory, "CallExpression") ||
    factory.optional ||
    factory.arguments.length !== 1 ||
    importedName(factory.callee, scopes) !== "defineConfig"
  )
    return false;
  const root = readFields(factory.arguments[0]!);
  if (
    !root ||
    ![...root.keys()].every((name) => supportedFields.has(name)) ||
    !readFactoryArray(root.get("presets"), stablePresets, scopes, true) ||
    !readFactoryArray(root.get("transformers"), jsxTransformers, scopes, false)
  )
    return false;
  const helpers = new Map<NonNullable<ReturnType<ScopeAnalysis["symbolFor"]>>, EsTreeNode>();
  for (const declaration of remainder) {
    if (!isNodeOfType(declaration, "VariableDeclaration") || declaration.kind !== "const")
      return false;
    for (const entry of declaration.declarations) {
      if (
        !isNodeOfType(entry.id, "Identifier") ||
        !isNodeOfType(entry.init, "ArrowFunctionExpression")
      )
        return false;
      const definition = scopes.symbolFor(entry.id);
      if (!definition) return false;
      helpers.set(definition, entry.init);
    }
  }
  const checkPrimitive = (node: EsTreeNode, containingHelper: EsTreeNode | null): boolean => {
    let safe = true;
    walkAst(node, (current) => {
      if (!safe || current.type.startsWith("TS")) return false;
      if (!primitiveSyntax.has(current.type)) {
        safe = false;
        return false;
      }
      if (isNodeOfType(current, "ArrowFunctionExpression") && current.async) safe = false;
      if (isNodeOfType(current, "ObjectExpression") && !readFields(current)) safe = false;
      if (isNodeOfType(current, "UnaryExpression") && !["+", "-", "!"].includes(current.operator))
        safe = false;
      if (isNodeOfType(current, "AssignmentExpression")) {
        const assignment = isNodeOfType(current.left, "Identifier")
          ? scopes.symbolFor(current.left)
          : null;
        if (
          !assignment ||
          current.operator !== "=" ||
          !isInside(assignment.declarationNode, containingHelper ?? node)
        )
          safe = false;
      }
      if (isNodeOfType(current, "MemberExpression") && !isPrimitiveMethod(current)) safe = false;
      if (isNodeOfType(current, "NewExpression")) {
        const callee = current.callee;
        if (
          !isNodeOfType(callee, "Identifier") ||
          callee.name !== "RegExp" ||
          !scopes.isGlobalReference(callee) ||
          current.arguments.length !== 1
        )
          safe = false;
      }
      if (isNodeOfType(current, "CallExpression")) {
        const callee = current.callee;
        const symbol = isNodeOfType(callee, "Identifier") ? scopes.symbolFor(callee) : null;
        if (current.optional || (!isPrimitiveMethod(callee) && (!symbol || !helpers.has(symbol))))
          safe = false;
        if (symbol && helpers.get(symbol) === containingHelper) safe = false;
      }
      if (isNodeOfType(current, "Identifier") && scopes.referenceFor(current)) {
        const symbol = scopes.symbolFor(current);
        if (!symbol) {
          if (
            current.name !== "RegExp" ||
            !isNodeOfType(current.parent, "NewExpression") ||
            current.parent.callee !== current
          )
            safe = false;
        } else if (
          !isInside(symbol.declarationNode, containingHelper ?? node) &&
          (!helpers.has(symbol) ||
            !isNodeOfType(current.parent, "CallExpression") ||
            current.parent.callee !== current)
        )
          safe = false;
      }
      return safe;
    });
    return safe;
  };
  for (const helper of helpers.values()) if (!checkPrimitive(helper, helper)) return false;
  for (const name of ["shortcuts", "rules"]) {
    const value = root.get(name);
    if (value && (!isNodeOfType(value, "ArrayExpression") || !checkPrimitive(value, null)))
      return false;
  }
  return true;
};
