import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findExportedValue } from "./find-exported-value.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { parseSourceFile } from "./parse-source-file.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const MAX_SLOT_ITERATIONS = 256;
const DIRECT_MODULE_EXTENSIONS = [
  ".mjs",
  ".js",
  ".mts",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
  ".cjs",
  ".cts",
];
const JSX_INSTANCE_PROPERTIES = new Set(["key", "position", "rotation", "scale"]);
const JSX_POOL_PROPERTIES = new Set([
  "limit",
  "geometry",
  "material",
  "frustumCulled",
  "castShadow",
]);
const INDIRECT_INTRINSIC_PROPERTIES = new Set([
  "prototype",
  "constructor",
  "__proto__",
  "getPrototypeOf",
  "setPrototypeOf",
  "mock",
  "doMock",
  "unstable_mockModule",
]);
const GLOBAL_OBJECT_NAMES = new Set(["globalThis", "window", "self", "global"]);
const intrinsicProofByProgram = new WeakMap<EsTreeNode, boolean>();

const plainMember = (node: EsTreeNode | null | undefined, name: string) =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === name
    ? node
    : null;

const directNamedImport = (node: EsTreeNode, scopes: ScopeAnalysis) => {
  const symbol = scopes.symbolFor(node);
  if (
    !symbol ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    !isSymbolReadOnly(symbol)
  )
    return null;
  const declaration = getImportDeclarationForSymbol(symbol);
  const name = getImportedName(symbol.declarationNode);
  return declaration &&
    declaration.importKind !== "type" &&
    !declaration.attributes?.length &&
    typeof declaration.source.value === "string" &&
    name
    ? { source: declaration.source.value, name }
    : null;
};

const isNamedProvider = (
  node: EsTreeNode,
  source: string,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  const imported = directNamedImport(node, scopes);
  return imported?.source === source && imported.name === name;
};

// Resolve only a direct, regular .ts leaf with no competing Vite extension
// or directory. The caller must establish the project's resolver contract.
export const resolveUniqueGeometryModule = (
  filename: string | undefined,
  source: string,
): string | null => {
  if (
    !filename ||
    !path.isAbsolute(filename) ||
    !/^\.\.?\/[\w./-]+$/.test(source) ||
    path.extname(source)
  )
    return null;
  const modulePath = path.resolve(path.dirname(filename), source);
  const expectedPath = `${modulePath}.ts`;
  for (const candidate of [
    modulePath,
    ...DIRECT_MODULE_EXTENSIONS.map((extension) => `${modulePath}${extension}`),
  ]) {
    recordExistenceProbe(candidate);
    try {
      const stat = fs.lstatSync(candidate, { throwIfNoEntry: false });
      if (candidate === expectedPath) {
        if (!stat?.isFile() || path.relative(candidate, fs.realpathSync(candidate)) !== "")
          return null;
      } else if (stat) {
        return null;
      }
    } catch {
      return null;
    }
  }
  return expectedPath;
};

const hasUnmodifiedGeometryIntrinsics = (scopes: ScopeAnalysis): boolean => {
  const program = scopes.rootScope.node;
  const cached = intrinsicProofByProgram.get(program);
  if (cached !== undefined) return cached;
  let closed = true;
  walkAst(program, (node) => {
    if (!closed) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      if (property && INDIRECT_INTRINSIC_PROPERTIES.has(property)) closed = false;
    }
    if (isNodeOfType(node, "ImportExpression") || isNodeOfType(node, "TSImportEqualsDeclaration"))
      closed = false;
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    if (
      GLOBAL_OBJECT_NAMES.has(node.name) ||
      node.name === "eval" ||
      node.name === "require" ||
      node.name === "Function" ||
      node.name === "Array" ||
      node.name === "Reflect"
    ) {
      closed = false;
      return false;
    }
    if (node.name !== "Math") return;
    const member = plainMember(node.parent, "random") ?? plainMember(node.parent, "floor");
    if (
      !member ||
      member.object !== node ||
      !isNodeOfType(member.parent, "CallExpression") ||
      member.parent.callee !== member
    )
      closed = false;
  });
  intrinsicProofByProgram.set(program, closed);
  return closed;
};

const getNumber = (value: EsTreeNode | null | undefined): number | null => {
  if (!value) return null;
  const number = stripParenExpression(value);
  if (
    isNodeOfType(number, "Literal") &&
    typeof number.value === "number" &&
    Number.isFinite(number.value)
  )
    return number.value;
  if (
    isNodeOfType(number, "UnaryExpression") &&
    (number.operator === "-" || number.operator === "+") &&
    isNodeOfType(number.argument, "Literal") &&
    typeof number.argument.value === "number" &&
    Number.isFinite(number.argument.value)
  )
    return number.operator === "-" ? -number.argument.value : number.argument.value;
  return null;
};

const isNumericTriple = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "ArrayExpression") &&
  node.elements.length === 3 &&
  node.elements.every((coordinate) => getNumber(coordinate) !== null);

const getMathCall = (node: EsTreeNode, name: string, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return null;
  const member = plainMember(node.callee, name);
  return member &&
    isNodeOfType(member.object, "Identifier") &&
    member.object.name === "Math" &&
    scopes.isGlobalReference(member.object)
    ? node
    : null;
};

const isRandom = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  getMathCall(node, "random", scopes)?.arguments.length === 0;

const isJitter = (node: EsTreeNode, scopes: ScopeAnalysis, allowCentred: boolean): boolean => {
  const call = getMathCall(stripParenExpression(node), "floor", scopes);
  const argument = call?.arguments[0] && stripParenExpression(call.arguments[0]);
  if (
    call?.arguments.length !== 1 ||
    !isNodeOfType(argument, "BinaryExpression") ||
    argument.operator !== "*"
  )
    return false;
  const factor = getNumber(argument.right);
  if (factor === null || factor <= 0 || factor > 10_000) return false;
  const sample = stripParenExpression(argument.left);
  return (
    isRandom(sample, scopes) ||
    (allowCentred &&
      isNodeOfType(sample, "BinaryExpression") &&
      sample.operator === "-" &&
      isRandom(stripParenExpression(sample.left), scopes) &&
      getNumber(sample.right) === 0.5)
  );
};

const isReferenceTo = (
  node: EsTreeNode,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "Identifier") && scopes.symbolFor(expression) === symbol;
};

// Two explicit append sites create independent left/right slots, rather
// than assigning existing entities to an index according to runtime order.
const isSideCoordinate = (
  node: EsTreeNode,
  side: number,
  index: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const constant = getNumber(node);
  if (constant !== null) return Math.sign(constant) === side;
  const expression = stripParenExpression(node);
  if (
    isNodeOfType(expression, "BinaryExpression") &&
    expression.operator === (side < 0 ? "-" : "+")
  ) {
    const base = getNumber(expression.left);
    if (base !== null && Math.sign(base) === side && isJitter(expression.right, scopes, false))
      return true;
  }
  const ordinal =
    side < 0 && isNodeOfType(expression, "UnaryExpression") && expression.operator === "-"
      ? stripParenExpression(expression.argument)
      : side > 0
        ? expression
        : null;
  return (
    isNodeOfType(ordinal, "BinaryExpression") &&
    ordinal.operator === "+" &&
    isReferenceTo(ordinal.left, index, scopes) &&
    (getNumber(ordinal.right) ?? 0) > 0
  );
};

const isGeometryBuilder = (fn: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isFunctionLike(fn) ||
    fn.async ||
    fn.generator ||
    fn.params.length ||
    !isNodeOfType(fn.body, "BlockStatement")
  )
    return false;
  const [allocation, loop, result] = fn.body.body;
  if (
    fn.body.body.length !== 3 ||
    !isNodeOfType(allocation, "VariableDeclaration") ||
    allocation.kind !== "const" ||
    allocation.declarations.length !== 1 ||
    !isNodeOfType(loop, "ForStatement") ||
    !isNodeOfType(loop.body, "BlockStatement") ||
    loop.body.body.length !== 2 ||
    !isNodeOfType(result, "ReturnStatement") ||
    !result.argument
  )
    return false;
  const decl = allocation.declarations[0];
  const array = decl.init;
  const rows = isNodeOfType(decl.id, "Identifier") ? scopes.symbolFor(decl.id) : null;
  if (
    !rows ||
    !isNodeOfType(array, "ArrayExpression") ||
    !array.elements.length ||
    !array.elements.every((element) => isNumericTriple(element)) ||
    !isReferenceTo(result.argument, rows, scopes)
  )
    return false;

  const { init, test, update } = loop;
  if (
    !isNodeOfType(init, "VariableDeclaration") ||
    init.kind !== "let" ||
    init.declarations.length !== 1 ||
    !isNodeOfType(test, "BinaryExpression") ||
    test.operator !== "<" ||
    !isNodeOfType(update, "UpdateExpression") ||
    update.operator !== "++"
  )
    return false;
  const indexDecl = init.declarations[0];
  const index = isNodeOfType(indexDecl.id, "Identifier") ? scopes.symbolFor(indexDecl.id) : null;
  const count = getNumber(test.right);
  if (
    !index ||
    getNumber(indexDecl.init) !== 0 ||
    !isReferenceTo(test.left, index, scopes) ||
    !isReferenceTo(update.argument, index, scopes) ||
    count === null ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_SLOT_ITERATIONS
  )
    return false;

  return loop.body.body.every((statement, slot) => {
    if (
      !isNodeOfType(statement, "ExpressionStatement") ||
      !isNodeOfType(statement.expression, "CallExpression") ||
      statement.expression.optional ||
      statement.expression.arguments.length !== 1
    )
      return false;
    const push = plainMember(statement.expression.callee, "push");
    const tuple = statement.expression.arguments[0];
    if (
      !push ||
      !isReferenceTo(push.object, rows, scopes) ||
      !isNodeOfType(tuple, "ArrayExpression") ||
      tuple.elements.length !== 3
    )
      return false;
    const [x, y, z] = tuple.elements;
    return Boolean(
      x &&
      z &&
      getNumber(y) === 0 &&
      isSideCoordinate(x, slot === 0 ? -1 : 1, index, scopes) &&
      (getNumber(z) !== null || isReferenceTo(z, index, scopes) || isJitter(z, scopes, true)),
    );
  });
};

interface Builder {
  readonly fn: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly declaration: EsTreeNode;
  readonly program: EsTreeNode;
  readonly modulePath: string | null;
}

const readFunctionBinding = (fn: EsTreeNode, scopes: ScopeAnalysis) => {
  const declaration = isNodeOfType(fn, "FunctionDeclaration") ? fn : fn.parent;
  if (isNodeOfType(declaration, "FunctionDeclaration") && declaration.id) {
    const symbols = getFunctionBindingSymbols(fn, scopes);
    const symbol = symbols[0];
    return symbols.length === 1 &&
      symbol.declarationNode === declaration &&
      isSymbolReadOnly(symbol)
      ? { declaration, symbol }
      : null;
  }
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== fn ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    declaration.parent.declarations.length !== 1
  )
    return null;
  const symbol = scopes.symbolFor(declaration.id);
  return symbol && isSymbolReadOnly(symbol) ? { declaration: declaration.parent, symbol } : null;
};

const readBuilder = (value: EsTreeNode, context: RuleContext): Builder | null => {
  const call = stripParenExpression(value);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return null;
  const symbol = context.scopes.symbolFor(call.callee);
  if (!symbol || !isSymbolReadOnly(symbol)) return null;
  const imported = directNamedImport(call.callee, context.scopes);
  if (!imported) {
    const fn = symbol.initializer;
    if (!fn || !isFunctionLike(fn)) return null;
    const owner = readFunctionBinding(fn, context.scopes);
    return owner?.symbol === symbol
      ? {
          fn,
          scopes: context.scopes,
          declaration: owner.declaration,
          program: context.scopes.rootScope.node,
          modulePath: null,
        }
      : null;
  }
  const modulePath = resolveUniqueGeometryModule(context.filename, imported.source);
  const program = modulePath && parseSourceFile(modulePath);
  if (!program) return null;
  const fn = findExportedValue(program, imported.name);
  if (!fn || !isFunctionLike(fn)) return null;
  const scopes = analyzeScopes(program);
  const owner = readFunctionBinding(fn, scopes);
  const exported = owner?.declaration.parent;
  return owner &&
    owner.symbol.name === imported.name &&
    isNodeOfType(exported, "ExportNamedDeclaration") &&
    exported.declaration === owner.declaration &&
    !exported.source
    ? { fn, scopes, declaration: exported, program, modulePath }
    : null;
};

const isGeometryScaleBuilder = (scale: Builder, positions: Builder): boolean => {
  if (
    scale.program !== positions.program ||
    !isFunctionLike(scale.fn) ||
    scale.fn.async ||
    scale.fn.generator ||
    scale.fn.params.length
  )
    return false;
  const returned = getSingleReturnExpression(scale.fn);
  const map = returned && stripParenExpression(returned);
  if (!isNodeOfType(map, "CallExpression") || map.optional || map.arguments.length !== 1)
    return false;
  const member = plainMember(map.callee, "map");
  const builderCall = member && stripParenExpression(member.object);
  const target = readFunctionBinding(positions.fn, scale.scopes);
  const callback = map.arguments[0];
  if (
    !isNodeOfType(builderCall, "CallExpression") ||
    builderCall.optional ||
    builderCall.arguments.length ||
    !target ||
    !isReferenceTo(builderCall.callee, target.symbol, scale.scopes) ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length
  )
    return false;
  const payload = stripParenExpression(callback.body);
  return (
    isNodeOfType(payload, "BinaryExpression") &&
    payload.operator === "+" &&
    isRandom(stripParenExpression(payload.left), scale.scopes) &&
    (getNumber(payload.right) ?? 0) > 0
  );
};

const readOwnProperties = (node: EsTreeNode, mode: "pattern" | "object") => {
  if (!isNodeOfType(node, "ObjectPattern") && !isNodeOfType(node, "ObjectExpression")) return null;
  if (mode !== (node.type === "ObjectPattern" ? "pattern" : "object")) return null;
  const properties = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method ||
      !isNodeOfType(property.key, "Identifier") ||
      property.key.name === "__proto__" ||
      properties.has(property.key.name) ||
      (mode === "pattern" && !isNodeOfType(property.value, "Identifier"))
    )
      return null;
    properties.set(property.key.name, property.value);
  }
  return properties;
};

const readJsxAttributes = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  allowed: ReadonlySet<string>,
) => {
  const attributes = new Map<string, EsTreeNodeOfType<"JSXAttribute">>();
  for (const attribute of opening.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      !allowed.has(attribute.name.name) ||
      attributes.has(attribute.name.name)
    )
      return null;
    attributes.set(attribute.name.name, attribute);
  }
  return attributes;
};

const getJsxValue = (attribute: EsTreeNodeOfType<"JSXAttribute"> | undefined): EsTreeNode | null =>
  isNodeOfType(attribute?.value, "JSXExpressionContainer")
    ? stripParenExpression(attribute.value.expression)
    : null;

const hasOnlySpecifiedReads = (
  symbol: SymbolDescriptor,
  reads: ReadonlyArray<EsTreeNode>,
  scopes: ScopeAnalysis,
): boolean => {
  const bindingProperty = symbol.bindingIdentifier.parent;
  // The parser gives an own shorthand binding separate key and value nodes.
  // Scope analysis may record that syntax-only key as a read of the binding.
  const shorthandKey =
    isNodeOfType(bindingProperty, "Property") &&
    bindingProperty.shorthand &&
    !bindingProperty.computed &&
    bindingProperty.value === symbol.bindingIdentifier &&
    bindingProperty.key !== bindingProperty.value &&
    isNodeOfType(bindingProperty.parent, "ObjectPattern")
      ? bindingProperty.key
      : null;
  const references = symbol.references.filter((reference) => reference.identifier !== shorthandKey);
  return (
    isSymbolReadOnly(symbol) &&
    references.length === reads.length &&
    references.every((reference) => reads.includes(reference.identifier)) &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  );
};

const isVisualInput = (node: EsTreeNode | null): boolean => {
  if (isNodeOfType(node, "Literal") || isNodeOfType(node, "Identifier")) return true;
  return (
    isNodeOfType(node, "MemberExpression") &&
    !node.optional &&
    (!node.computed || isNodeOfType(node.property, "Literal")) &&
    isVisualInput(stripParenExpression(node.object))
  );
};

export const isClosedGeneratedGeometrySlotMap = (
  key: EsTreeNodeOfType<"JSXAttribute">,
  iterator: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const { scopes } = context;
  const map = plainMember(iterator.callee, "map");
  const render = iterator.arguments[0];
  const child = key.parent;
  const childElement = child?.parent;
  if (
    !map ||
    iterator.optional ||
    iterator.arguments.length !== 1 ||
    !isNodeOfType(map.object, "Identifier") ||
    !isNodeOfType(render, "ArrowFunctionExpression") ||
    render.async ||
    render.params.length !== 2 ||
    !isNodeOfType(child, "JSXOpeningElement") ||
    !isNodeOfType(childElement, "JSXElement") ||
    !child.selfClosing ||
    stripParenExpression(render.body) !== childElement ||
    !isNodeOfType(child.name, "JSXIdentifier") ||
    !isNamedProvider(child.name, "@react-three/drei", "Instance", scopes)
  )
    return false;

  const parentExpression = findTransparentExpressionRoot(iterator).parent;
  const pool = parentExpression?.parent;
  if (
    !isNodeOfType(parentExpression, "JSXExpressionContainer") ||
    !isNodeOfType(pool, "JSXElement") ||
    pool.children.some(
      (item) => item !== parentExpression && (!isNodeOfType(item, "JSXText") || item.value.trim()),
    ) ||
    !isNodeOfType(pool.openingElement.name, "JSXIdentifier") ||
    !isNamedProvider(pool.openingElement.name, "@react-three/drei", "Instances", scopes)
  )
    return false;
  const childAttributes = readJsxAttributes(child, JSX_INSTANCE_PROPERTIES);
  const parentAttributes = readJsxAttributes(pool.openingElement, JSX_POOL_PROPERTIES);
  if (
    !childAttributes ||
    childAttributes.size !== 4 ||
    childAttributes.get("key") !== key ||
    !parentAttributes
  )
    return false;
  for (const [name, attribute] of parentAttributes) {
    if (name === "limit") continue;
    if (name === "frustumCulled" || name === "castShadow") {
      const value = getJsxValue(attribute);
      if (attribute.value && !(isNodeOfType(value, "Literal") && typeof value.value === "boolean"))
        return false;
    } else if (!isVisualInput(getJsxValue(attribute))) return false;
  }

  const position = getJsxValue(childAttributes.get("position"));
  const keyValue = getJsxValue(key);
  const scale = getJsxValue(childAttributes.get("scale"));
  const [itemParam, indexParam] = render.params;
  const row = isNodeOfType(itemParam, "Identifier") ? scopes.symbolFor(itemParam) : null;
  const index = isNodeOfType(indexParam, "Identifier") ? scopes.symbolFor(indexParam) : null;
  const positions = scopes.symbolFor(map.object);
  const limit = plainMember(getJsxValue(parentAttributes.get("limit")), "length");
  if (
    !row ||
    !index ||
    !positions ||
    positions.kind !== "const" ||
    !position ||
    !keyValue ||
    !isReferenceTo(position, row, scopes) ||
    !isReferenceTo(keyValue, index, scopes) ||
    !isNumericTriple(getJsxValue(childAttributes.get("rotation"))) ||
    !limit ||
    !isNodeOfType(limit.object, "Identifier") ||
    !isReferenceTo(limit.object, positions, scopes) ||
    !hasOnlySpecifiedReads(positions, [map.object, limit.object], scopes)
  )
    return false;

  const declaration = positions.declarationNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.optional ||
    declaration.init.arguments.length !== 2 ||
    !isNodeOfType(declaration.init.callee, "Identifier") ||
    !isNamedProvider(declaration.init.callee, "react", "useMemo", scopes)
  )
    return false;
  const [factory, deps] = declaration.init.arguments;
  if (
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    factory.params.length ||
    !isNodeOfType(deps, "ArrayExpression") ||
    deps.elements.length
  )
    return false;
  const returned = getSingleReturnExpression(factory);
  const values = returned && readOwnProperties(stripParenExpression(returned), "object");
  const bindings = readOwnProperties(declaration.id, "pattern");
  if (
    !bindings ||
    !values ||
    bindings.size !== values.size ||
    Array.from(bindings.keys()).some((name) => !values.has(name))
  )
    return false;
  const positionsProperty = [...bindings].find(
    ([, binding]) => binding === positions.bindingIdentifier,
  )?.[0];
  const positionsValue = positionsProperty && values.get(positionsProperty);
  const builder = positionsValue && readBuilder(positionsValue, context);
  if (
    !builder ||
    !isGeometryBuilder(builder.fn, builder.scopes) ||
    !hasUnmodifiedGeometryIntrinsics(scopes) ||
    !hasUnmodifiedGeometryIntrinsics(builder.scopes)
  )
    return false;

  let scaleBuilder: Builder | null = null;
  if (getNumber(scale) !== null) {
    if (bindings.size !== 1) return false;
  } else {
    if (
      bindings.size !== 2 ||
      !isNodeOfType(scale, "MemberExpression") ||
      !scale.computed ||
      scale.optional ||
      !isNodeOfType(scale.object, "Identifier") ||
      !isReferenceTo(scale.property, index, scopes)
    )
      return false;
    const scaleSymbol = scopes.symbolFor(scale.object);
    const scaleProperty = [...bindings].find(
      ([, binding]) => binding === scaleSymbol?.bindingIdentifier,
    )?.[0];
    const value = scaleProperty && values.get(scaleProperty);
    if (!scaleSymbol || !value || !hasOnlySpecifiedReads(scaleSymbol, [scale.object], scopes))
      return false;
    scaleBuilder = readBuilder(value, context);
    if (!scaleBuilder || !isGeometryScaleBuilder(scaleBuilder, builder)) return false;
  }

  if (!builder.modulePath) return true;
  return (
    isNodeOfType(builder.program, "Program") &&
    builder.program.body.every(
      (statement) => statement === builder.declaration || statement === scaleBuilder?.declaration,
    )
  );
};
