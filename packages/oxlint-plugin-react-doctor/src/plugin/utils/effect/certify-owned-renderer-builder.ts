import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import { collectConstAliasSymbols } from "../collect-const-alias-symbols.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { findEnclosingFunction } from "../find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../get-direct-const-initializer.js";
import { getResolvedStaticPropertyName } from "../get-resolved-static-property-name.js";
import { isAstDescendant } from "../is-ast-descendant.js";
import { isFunctionLike } from "../is-function-like.js";
import { isNodeOfType } from "../is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../is-proven-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../is-within-assignment-target.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { walkAst } from "../walk-ast.js";
import { isEmptyOrVoidZeroStatement } from "./is-empty-or-void-zero-statement.js";
import { isSupportedNativeDelayWriter } from "./is-supported-native-delay-writer.js";
import { isSupportedRuntimeScopeNode } from "./is-supported-runtime-scope-node.js";
import {
  NATIVE_DELAY_MAX_ALIAS_DEPTH,
  NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT,
  NATIVE_DELAY_PROTECTED_MEMBER_NAMES,
} from "./native-signal-delay/constants.js";
import {
  OWNED_RENDERER_BUILDER_CONTAINER_COUNT,
  OWNED_RENDERER_BUILDER_READONLY_STATICS,
  OWNED_RENDERER_BUILDER_RESULT_FIELD_COUNT,
  OWNED_RENDERER_BUILDER_INTRINSIC_NAMES,
  OWNED_RENDERER_BUILDER_INTRINSIC_MEMBERS,
  OWNED_RENDERER_BUILDER_UNSUPPORTED_KEYS,
  OWNED_RENDERER_BUILDER_TOKEN_FIELDS,
} from "./owned-renderer-builder/constants.js";

export interface OwnedRendererBuilderCallback {
  readonly callback: EsTreeNode;
  readonly methodName: string;
}

export interface OwnedRendererBuilderContext {
  readonly module: SourceProjectModule;
  readonly projectIndex: SourceProjectIndex;
  readonly getInstance: (expression: EsTreeNode) => EsTreeNode | null;
  readonly getConfigurationCallbacks: (
    expression: EsTreeNode,
  ) => ReadonlyArray<OwnedRendererBuilderCallback> | null;
  readonly getFallbackMethod: (call: EsTreeNode, module: SourceProjectModule) => string | null;
  readonly isParserCall: (call: EsTreeNode, callback: EsTreeNode) => boolean;
  readonly spendStep: () => boolean;
}

export interface OwnedRendererBuilderCertificate {
  readonly captures: ReadonlySet<SymbolDescriptor>;
  readonly callbacks: ReadonlySet<EsTreeNode>;
}

interface BuilderValue {
  readonly kind:
    | "scalar"
    | "string"
    | "number"
    | "boolean"
    | "null"
    | "optional-number"
    | "nullable-string"
    | "token"
    | "token-array"
    | "array"
    | "counter";
  readonly methodName?: string;
}

interface BuilderProof {
  readonly context: OwnedRendererBuilderContext;
  readonly wrapper: EsTreeNode;
  readonly values: Map<SymbolDescriptor, BuilderValue>;
  readonly allowed: Set<EsTreeNode>;
  readonly owned: Set<SymbolDescriptor>;
  readonly helpers: Map<SymbolDescriptor, EsTreeNode>;
  readonly activeHelpers: Set<EsTreeNode>;
  readonly callbacks: OwnedRendererBuilderCallback[];
  instance: EsTreeNode | null;
  html: SymbolDescriptor | null;
  arrayCount: number;
  counterCount: number;
}

const isScalar = (value: BuilderValue | null): boolean =>
  Boolean(value && !["token", "token-array", "array", "counter"].includes(value.kind));
const readonlySymbol = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");
const propertyName = (node: EsTreeNode, proof: BuilderProof): string | null =>
  getResolvedStaticPropertyName(node, proof.context.module.scopes, {
    allowConstTemplateLiteral: true,
  });

const valueForIdentifier = (
  node: EsTreeNode,
  values: ReadonlyMap<SymbolDescriptor, BuilderValue>,
  proof: BuilderProof,
): BuilderValue | null => {
  const symbol = proof.context.module.scopes.symbolFor(node);
  const initializer = symbol && readonlySymbol(symbol) && getDirectConstInitializer(symbol);
  const literal = initializer && stripParenExpression(initializer);
  const primitive =
    isNodeOfType(literal, "Literal") &&
    (literal.value === null || ["string", "number", "boolean"].includes(typeof literal.value));
  const value =
    symbol &&
    (values.get(symbol) ?? (primitive ? scalarValue(literal, values, proof, null, true) : null));
  if (!value) return null;
  proof.allowed.add(node);
  if (isNodeOfType(node.parent, "Property") && node.parent.shorthand)
    proof.allowed.add(node.parent.key);
  return value;
};

const tokenField = (method: string, field: string): BuilderValue | null => {
  const kind = OWNED_RENDERER_BUILDER_TOKEN_FIELDS[method]?.[field];
  return kind === "string" ||
    kind === "number" ||
    kind === "boolean" ||
    kind === "nullable-string" ||
    kind === "token-array"
    ? { kind }
    : null;
};

const helperValue = (
  call: EsTreeNode,
  values: ReadonlyMap<SymbolDescriptor, BuilderValue>,
  proof: BuilderProof,
  depth: number,
): BuilderValue | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return null;
  const symbol = proof.context.module.scopes.symbolFor(call.callee);
  const initializer =
    symbol &&
    (symbol.kind === "function" ? symbol.declarationNode : getDirectConstInitializer(symbol));
  const localHelper =
    symbol &&
    readonlySymbol(symbol) &&
    initializer &&
    isFunctionLike(initializer) &&
    !findEnclosingFunction(symbol.declarationNode)
      ? initializer
      : null;
  const helper = symbol && (proof.helpers.get(symbol) ?? localHelper);
  if (symbol && helper) proof.helpers.set(symbol, helper);
  if (
    !symbol ||
    !isFunctionLike(helper) ||
    helper.async ||
    helper.generator ||
    proof.activeHelpers.has(helper) ||
    helper.params.length !== call.arguments.length
  )
    return null;
  const environment = new Map(proof.values);
  for (const [index, parameter] of helper.params.entries()) {
    if (!isNodeOfType(parameter, "Identifier")) return null;
    const parameterSymbol = proof.context.module.scopes.symbolFor(parameter);
    const argument = scalarValue(call.arguments[index], values, proof, null, true, depth + 1);
    if (!parameterSymbol || !argument || !isScalar(argument)) return null;
    environment.set(parameterSymbol, argument);
  }
  proof.allowed.add(call.callee);
  proof.activeHelpers.add(helper);
  const result = isNodeOfType(helper.body, "BlockStatement")
    ? callbackBody(helper.body.body, environment, proof, null, true, depth + 1)
    : scalarValue(helper.body, environment, proof, null, true, depth + 1);
  proof.activeHelpers.delete(helper);
  return isScalar(result) ? result : null;
};

const scalarValue = (
  expression: EsTreeNode,
  values: ReadonlyMap<SymbolDescriptor, BuilderValue>,
  proof: BuilderProof,
  callback: OwnedRendererBuilderCallback | null,
  helper: boolean,
  depth = 0,
): BuilderValue | null => {
  if (!proof.context.spendStep() || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) return null;
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Literal")) {
    if (node.value === null) return { kind: "null" };
    const kind = typeof node.value;
    return kind === "string" || kind === "number" || kind === "boolean" ? { kind } : null;
  }
  if (isNodeOfType(node, "Identifier")) return valueForIdentifier(node, values, proof);
  if (isNodeOfType(node, "MemberExpression") && !node.optional) {
    const receiver = scalarValue(node.object, values, proof, callback, helper, depth + 1);
    const name = propertyName(node, proof);
    if (receiver?.kind === "token" && receiver.methodName && name)
      return tokenField(receiver.methodName, name);
    if (
      !helper &&
      receiver?.kind === "array" &&
      name === "length" &&
      !isWithinAssignmentTarget(node)
    )
      return { kind: "number" };
    return null;
  }
  if (isNodeOfType(node, "BinaryExpression")) {
    const left = scalarValue(node.left, values, proof, callback, helper, depth + 1);
    const right = scalarValue(node.right, values, proof, callback, helper, depth + 1);
    if (!left || !right || !isScalar(left) || !isScalar(right)) return null;
    if (["===", "!==", "==", "!=", "<", "<=", ">", ">="].includes(node.operator))
      return { kind: "boolean" };
    if (node.operator === "+" && (left.kind === "string" || right.kind === "string"))
      return { kind: "string" };
    return left.kind === "number" &&
      right.kind === "number" &&
      ["+", "-", "*", "/", "%", "**"].includes(node.operator)
      ? { kind: "number" }
      : null;
  }
  if (isNodeOfType(node, "LogicalExpression") && ["??", "||", "&&"].includes(node.operator)) {
    const left = scalarValue(node.left, values, proof, callback, helper, depth + 1);
    const right = scalarValue(node.right, values, proof, callback, helper, depth + 1);
    if (node.operator !== "&&" && left?.kind === "optional-number" && right?.kind === "number")
      return { kind: "number" };
    if (node.operator !== "&&" && left?.kind === "nullable-string" && right?.kind === "string")
      return { kind: "string" };
    return left && right && isScalar(left) && isScalar(right)
      ? { kind: left.kind === right.kind ? left.kind : "scalar" }
      : null;
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    const test = scalarValue(node.test, values, proof, callback, helper, depth + 1);
    const consequent = scalarValue(node.consequent, values, proof, callback, helper, depth + 1);
    const alternate = scalarValue(node.alternate, values, proof, callback, helper, depth + 1);
    return isScalar(test) && consequent && alternate && isScalar(consequent) && isScalar(alternate)
      ? { kind: consequent.kind === alternate.kind ? consequent.kind : "scalar" }
      : null;
  }
  if (isNodeOfType(node, "TemplateLiteral"))
    return node.expressions.every((part) =>
      isScalar(scalarValue(part, values, proof, callback, helper, depth + 1)),
    )
      ? { kind: "string" }
      : null;
  if (isNodeOfType(node, "UnaryExpression") && ["+", "-", "!"].includes(node.operator)) {
    const argument = scalarValue(node.argument, values, proof, callback, helper, depth + 1);
    return node.operator === "!" && isScalar(argument)
      ? { kind: "boolean" }
      : argument?.kind === "number"
        ? argument
        : null;
  }
  if (!isNodeOfType(node, "CallExpression") || node.optional) return null;
  const fallback = callback && proof.context.getFallbackMethod(node, proof.context.module);
  if (
    !helper &&
    callback &&
    fallback === callback.methodName &&
    node.arguments.length === 2 &&
    isNodeOfType(node.arguments[0], "ThisExpression") &&
    findEnclosingFunction(node.arguments[0]) === callback.callback &&
    scalarValue(node.arguments[1], values, proof, callback, helper, depth + 1)?.kind === "token"
  )
    return { kind: "string" };
  if (!helper && callback && proof.context.isParserCall(node, callback.callback)) {
    const [tokens, ...remaining] = node.arguments;
    return tokens &&
      remaining.length === 0 &&
      scalarValue(tokens, values, proof, callback, helper, depth + 1)?.kind === "token-array"
      ? { kind: "string" }
      : null;
  }
  const callee = stripParenExpression(node.callee);
  if (
    !helper &&
    isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    propertyName(callee, proof) === "get"
  ) {
    const receiver = scalarValue(callee.object, values, proof, callback, helper, depth + 1);
    const [key, ...remaining] = node.arguments;
    return receiver?.kind === "counter" &&
      key &&
      remaining.length === 0 &&
      scalarValue(key, values, proof, callback, helper, depth + 1)?.kind === "string"
      ? { kind: "optional-number" }
      : null;
  }
  if (isNodeOfType(callee, "MemberExpression") && !callee.optional) {
    const name = propertyName(callee, proof);
    const receiver = stripParenExpression(callee.object);
    if (
      isNodeOfType(receiver, "Literal") &&
      "regex" in receiver &&
      name === "test" &&
      node.arguments.length === 1 &&
      scalarValue(node.arguments[0], values, proof, callback, helper, depth + 1)?.kind === "string"
    ) {
      return { kind: "boolean" };
    }
    const value = scalarValue(receiver, values, proof, callback, helper, depth + 1);
    if (value?.kind === "string" || value?.kind === "nullable-string") {
      if ((name === "trim" || name === "toLowerCase") && node.arguments.length === 0)
        return { kind: "string" };
      if (
        name === "startsWith" &&
        node.arguments.length === 1 &&
        scalarValue(node.arguments[0], values, proof, callback, helper, depth + 1)?.kind ===
          "string"
      )
        return { kind: "boolean" };
      if (name === "replace" && node.arguments.length === 2) {
        const pattern = stripParenExpression(node.arguments[0]);
        const replacement = scalarValue(
          node.arguments[1],
          values,
          proof,
          callback,
          helper,
          depth + 1,
        );
        const regex = isNodeOfType(pattern, "Literal") && "regex" in pattern;
        const literalString = isNodeOfType(pattern, "Literal") && typeof pattern.value === "string";
        if ((regex || literalString) && replacement?.kind === "string") {
          return { kind: "string" };
        }
      }
    }
  }
  return helperValue(node, values, proof, depth + 1);
};

const flatRecord = (
  expression: EsTreeNode,
  values: ReadonlyMap<SymbolDescriptor, BuilderValue>,
  proof: BuilderProof,
  callback: OwnedRendererBuilderCallback,
  depth: number,
): boolean => {
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "ObjectExpression")) return false;
  const keys = new Set<string>();
  return node.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed
    )
      return false;
    const key = propertyName(property, proof);
    if (!key || keys.has(key) || OWNED_RENDERER_BUILDER_UNSUPPORTED_KEYS.has(key)) return false;
    keys.add(key);
    return isScalar(scalarValue(property.value, values, proof, callback, false, depth + 1));
  });
};

const callbackStatements = (
  statements: ReadonlyArray<EsTreeNode>,
  values: Map<SymbolDescriptor, BuilderValue>,
  proof: BuilderProof,
  callback: OwnedRendererBuilderCallback | null,
  helper: boolean,
  depth: number,
  allowReturn: boolean,
  returns: BuilderValue[],
): boolean => {
  for (const [index, statement] of statements.entries()) {
    if (!proof.context.spendStep() || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) return false;
    if (isEmptyOrVoidZeroStatement(statement)) continue;
    if (isNodeOfType(statement, "ReturnStatement")) {
      const value =
        statement.argument &&
        scalarValue(statement.argument, values, proof, callback, helper, depth + 1);
      if (!allowReturn || index !== statements.length - 1 || !value || !isScalar(value))
        return false;
      returns.push(value);
      continue;
    }
    if (isNodeOfType(statement, "IfStatement")) {
      if (!isScalar(scalarValue(statement.test, values, proof, callback, helper, depth + 1)))
        return false;
      for (const branch of [statement.consequent, statement.alternate]) {
        if (!branch) continue;
        const branchStatements = isNodeOfType(branch, "BlockStatement") ? branch.body : [branch];
        if (
          !callbackStatements(
            branchStatements,
            new Map(values),
            proof,
            callback,
            helper,
            depth + 1,
            true,
            returns,
          )
        )
          return false;
      }
      continue;
    }
    if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
      for (const declaration of statement.declarations) {
        if (!isNodeOfType(declaration.id, "Identifier") || !declaration.init) return false;
        const symbol = proof.context.module.scopes.symbolFor(declaration.id);
        const value = scalarValue(declaration.init, values, proof, callback, helper, depth + 1);
        if (
          !symbol ||
          !readonlySymbol(symbol) ||
          !value ||
          (!isScalar(value) &&
            !(
              isNodeOfType(stripParenExpression(declaration.init), "Identifier") &&
              !helper &&
              ["array", "counter"].includes(value.kind)
            ))
        )
          return false;
        values.set(symbol, value);
      }
      continue;
    }
    if (
      helper ||
      !callback ||
      !isNodeOfType(statement, "ExpressionStatement") ||
      !isNodeOfType(statement.expression, "CallExpression")
    )
      return false;
    const call = statement.expression;
    const callee = stripParenExpression(call.callee);
    if (call.optional || !isNodeOfType(callee, "MemberExpression") || callee.optional) return false;
    const receiver = scalarValue(callee.object, values, proof, callback, false, depth + 1);
    const [first, second, ...remaining] = call.arguments;
    if (
      receiver?.kind === "array" &&
      propertyName(callee, proof) === "push" &&
      first &&
      !second &&
      flatRecord(first, values, proof, callback, depth + 1)
    )
      continue;
    if (
      receiver?.kind === "counter" &&
      propertyName(callee, proof) === "set" &&
      first &&
      second &&
      remaining.length === 0 &&
      scalarValue(first, values, proof, callback, false, depth + 1)?.kind === "string" &&
      scalarValue(second, values, proof, callback, false, depth + 1)?.kind === "number"
    )
      continue;
    return false;
  }
  return true;
};

const callbackBody = (
  statements: ReadonlyArray<EsTreeNode>,
  values: Map<SymbolDescriptor, BuilderValue>,
  proof: BuilderProof,
  callback: OwnedRendererBuilderCallback | null,
  helper: boolean,
  depth: number,
): BuilderValue | null => {
  const last = statements.at(-1);
  if (!isNodeOfType(last, "ReturnStatement") || !last.argument) return null;
  const returns: BuilderValue[] = [];
  if (
    !callbackStatements(
      statements.slice(0, -1),
      values,
      proof,
      callback,
      helper,
      depth + 1,
      false,
      returns,
    )
  )
    return null;
  const result = scalarValue(last.argument, values, proof, callback, helper, depth + 1);
  if (!result || !isScalar(result)) return null;
  return returns.every((value) => value.kind === result.kind) ? result : { kind: "scalar" };
};

const hasSupportedSourceIntrinsicUses = (context: OwnedRendererBuilderContext): boolean => {
  const protectedNames = new Set([
    ...NATIVE_DELAY_PROTECTED_MEMBER_NAMES,
    ...OWNED_RENDERER_BUILDER_INTRINSIC_MEMBERS,
  ]);
  let valid = true;
  for (const module of context.projectIndex.modulesByFilePath.values()) {
    walkAst(module.programNode, (node) => {
      if (!valid || !context.spendStep()) {
        valid = false;
        return false;
      }
      if (
        !isSupportedRuntimeScopeNode(node, module.scopes) ||
        !isSupportedNativeDelayWriter(node, module.scopes, protectedNames)
      ) {
        valid = false;
        return false;
      }
      if (isNodeOfType(node, "MemberExpression")) {
        const name = getResolvedStaticPropertyName(node, module.scopes, {
          allowConstTemplateLiteral: true,
        });
        if (name && OWNED_RENDERER_BUILDER_UNSUPPORTED_KEYS.has(name)) {
          let root = findTransparentExpressionRoot(node);
          while (isNodeOfType(root.parent, "MemberExpression") && root.parent.object === root)
            root = findTransparentExpressionRoot(root.parent);
          if (
            !isNodeOfType(root.parent, "CallExpression") ||
            root.parent.callee !== root ||
            !context.getFallbackMethod(root.parent, module)
          ) {
            valid = false;
            return false;
          }
        }
        if (
          (name === "getPrototypeOf" || name === "setPrototypeOf" || name === null) &&
          (isProvenGlobalNamespaceReference(node.object, "Object", module.scopes) ||
            isProvenGlobalNamespaceReference(node.object, "Reflect", module.scopes))
        ) {
          valid = false;
          return false;
        }
      }
      if (isProvenGlobalObjectReference(node, module.scopes)) {
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          getResolvedStaticPropertyName(parent, module.scopes) === null ||
          isWithinAssignmentTarget(parent)
        ) {
          valid = false;
          return false;
        }
      }
      for (const name of OWNED_RENDERER_BUILDER_INTRINSIC_NAMES) {
        if (!isProvenGlobalNamespaceReference(node, name, module.scopes)) continue;
        if (
          module.scopes.symbolFor(node)?.bindingIdentifier === node &&
          !module.scopes.referenceFor(node)
        )
          continue;
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        if (
          module.scopes.referenceFor(node)?.flag &&
          module.scopes.referenceFor(node)?.flag !== "read"
        ) {
          valid = false;
          return false;
        }
        if (
          name !== "eval" &&
          name !== "Function" &&
          (isNodeOfType(parent, "NewExpression") || isNodeOfType(parent, "CallExpression")) &&
          parent.callee === root
        )
          continue;
        if (
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === root &&
          isNodeOfType(parent.id, "Identifier")
        ) {
          const alias = module.scopes.symbolFor(parent.id);
          if (alias?.kind === "const" && readonlySymbol(alias)) continue;
        }
        if (
          isNodeOfType(parent, "MemberExpression") &&
          !parent.optional &&
          parent.object === root &&
          OWNED_RENDERER_BUILDER_READONLY_STATICS[name]?.has(
            getResolvedStaticPropertyName(parent, module.scopes) ?? "",
          )
        ) {
          const memberRoot = findTransparentExpressionRoot(parent);
          if (
            isNodeOfType(memberRoot.parent, "CallExpression") &&
            memberRoot.parent.callee === memberRoot &&
            !memberRoot.parent.optional
          )
            continue;
        }
        valid = false;
        return false;
      }
      return;
    });
    if (!valid) return false;
  }
  return valid;
};

const addContainer = (
  symbol: SymbolDescriptor,
  kind: "array" | "counter",
  proof: BuilderProof,
): boolean => {
  const aliases = collectConstAliasSymbols(symbol, proof.context.module.scopes);
  if (
    aliases.length > NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT ||
    aliases.some(
      (alias) => !readonlySymbol(alias) || !isAstDescendant(alias.declarationNode, proof.wrapper),
    )
  )
    return false;
  for (const alias of aliases) {
    proof.owned.add(alias);
    proof.values.set(alias, { kind });
  }
  return true;
};

const readConfiguration = (configuration: EsTreeNode, proof: BuilderProof): boolean => {
  const callbacks = proof.context.getConfigurationCallbacks(configuration);
  const node = stripParenExpression(configuration);
  if (
    !callbacks ||
    !isNodeOfType(node, "ObjectExpression") ||
    node.properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        propertyName(property, proof) === "async" &&
        (!isNodeOfType(property.value, "Literal") || property.value.value !== false),
    )
  )
    return false;
  proof.callbacks.push(...callbacks);
  return true;
};

export const certifyOwnedRendererBuilder = (
  callback: EsTreeNode,
  context: OwnedRendererBuilderContext,
): OwnedRendererBuilderCertificate | null => {
  if (context.projectIndex.modulesByFilePath.get(context.module.filePath) !== context.module)
    return null;
  const wrapper = findEnclosingFunction(callback);
  if (
    !isFunctionLike(wrapper) ||
    wrapper.async ||
    wrapper.generator ||
    !isNodeOfType(wrapper.body, "BlockStatement")
  )
    return null;
  const proof: BuilderProof = {
    context,
    wrapper,
    values: new Map(),
    allowed: new Set(),
    owned: new Set(),
    helpers: new Map(),
    activeHelpers: new Set(),
    callbacks: [],
    instance: null,
    html: null,
    arrayCount: 0,
    counterCount: 0,
  };
  const statements = wrapper.body.body;
  const terminal = statements.at(-1);
  if (
    !isNodeOfType(terminal, "ReturnStatement") ||
    !isNodeOfType(terminal.argument, "ObjectExpression")
  )
    return null;
  let parsed = false;
  for (const statement of statements.slice(0, -1)) {
    if (!context.spendStep()) return null;
    if (isEmptyOrVoidZeroStatement(statement)) continue;
    if (parsed) return null;
    if (isNodeOfType(statement, "FunctionDeclaration")) {
      const symbol = statement.id && context.module.scopes.symbolFor(statement.id);
      if (!symbol || statement.async || statement.generator || !readonlySymbol(symbol)) return null;
      proof.helpers.set(symbol, statement);
      continue;
    }
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      isNodeOfType(statement.expression, "CallExpression")
    ) {
      const call = statement.expression;
      const callee = stripParenExpression(call.callee);
      if (
        call.optional ||
        !proof.instance ||
        !isNodeOfType(callee, "MemberExpression") ||
        callee.optional ||
        propertyName(callee, proof) !== "use" ||
        context.getInstance(callee.object) !== proof.instance ||
        call.arguments.length === 0
      )
        return null;
      if (isNodeOfType(stripParenExpression(callee.object), "Identifier"))
        proof.allowed.add(stripParenExpression(callee.object));
      if (!call.arguments.every((argument) => readConfiguration(argument, proof))) return null;
      continue;
    }
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return null;
    for (const declaration of statement.declarations) {
      if (parsed || !isNodeOfType(declaration.id, "Identifier") || !declaration.init) return null;
      const symbol = context.module.scopes.symbolFor(declaration.id);
      const init = stripParenExpression(declaration.init);
      if (!symbol || !readonlySymbol(symbol)) return null;
      if (isNodeOfType(init, "ArrayExpression") && init.elements.length === 0) {
        proof.arrayCount += 1;
        if (!addContainer(symbol, "array", proof)) return null;
      } else if (
        isNodeOfType(init, "NewExpression") &&
        isProvenGlobalNamespaceReference(init.callee, "Map", context.module.scopes) &&
        init.arguments.length === 0
      ) {
        proof.counterCount += 1;
        if (!addContainer(symbol, "counter", proof)) return null;
      } else if (isNodeOfType(init, "NewExpression") && context.getInstance(init) === init) {
        if (
          proof.instance ||
          !init.arguments.every((argument) => readConfiguration(argument, proof))
        )
          return null;
        proof.instance = init;
      } else if (
        proof.instance &&
        isNodeOfType(init, "CallExpression") &&
        isNodeOfType(init.callee, "MemberExpression") &&
        propertyName(init.callee, proof) === "parse" &&
        context.getInstance(init.callee.object) === proof.instance
      ) {
        const [source, options, ...remaining] = init.arguments;
        const sourceNode = source && stripParenExpression(source);
        const sourceSymbol = sourceNode && context.module.scopes.symbolFor(sourceNode);
        const sourceIsClosed =
          (isNodeOfType(sourceNode, "Literal") && typeof sourceNode.value === "string") ||
          (isNodeOfType(sourceNode, "Identifier") &&
            sourceSymbol &&
            readonlySymbol(sourceSymbol) &&
            (sourceSymbol.kind === "parameter" ||
              proof.values.get(sourceSymbol)?.kind === "string"));
        if (
          !sourceIsClosed ||
          remaining.length > 0 ||
          statement.declarations.length !== 1 ||
          !isNodeOfType(options, "ObjectExpression") ||
          !context.getConfigurationCallbacks(options) ||
          !options.properties.some(
            (property) =>
              isNodeOfType(property, "Property") &&
              propertyName(property, proof) === "async" &&
              isNodeOfType(property.value, "Literal") &&
              property.value.value === false,
          ) ||
          options.properties.some(
            (property) =>
              isNodeOfType(property, "Property") && propertyName(property, proof) === "renderer",
          )
        )
          return null;
        if (isNodeOfType(stripParenExpression(init.callee.object), "Identifier"))
          proof.allowed.add(stripParenExpression(init.callee.object));
        proof.html = symbol;
        proof.values.set(symbol, { kind: "string" });
        parsed = true;
      } else if (isFunctionLike(init)) {
        if (init.async || init.generator) return null;
        proof.helpers.set(symbol, init);
      } else if (
        isNodeOfType(init, "Identifier") &&
        proof.instance &&
        context.getInstance(init) === proof.instance
      ) {
        proof.allowed.add(init);
      } else {
        const value = scalarValue(init, proof.values, proof, null, false);
        if (
          !value ||
          (!isScalar(value) &&
            !(isNodeOfType(init, "Identifier") && ["array", "counter"].includes(value.kind)))
        )
          return null;
        proof.values.set(symbol, value);
      }
    }
  }
  if (
    !parsed ||
    !proof.instance ||
    !proof.html ||
    proof.arrayCount !== OWNED_RENDERER_BUILDER_CONTAINER_COUNT ||
    proof.counterCount !== OWNED_RENDERER_BUILDER_CONTAINER_COUNT ||
    !proof.callbacks.some((entry) => entry.callback === callback)
  )
    return null;
  const returned = terminal.argument;
  if (returned.properties.length !== OWNED_RENDERER_BUILDER_RESULT_FIELD_COUNT) return null;
  let returnsHtml = false;
  let returnsRecords = false;
  const returnKeys = new Set<string>();
  for (const property of returned.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const key = propertyName(property, proof);
    if (!key || returnKeys.has(key) || OWNED_RENDERER_BUILDER_UNSUPPORTED_KEYS.has(key))
      return null;
    returnKeys.add(key);
    const symbol = context.module.scopes.symbolFor(property.value);
    const value = scalarValue(property.value, proof.values, proof, null, false);
    if (symbol === proof.html) returnsHtml = true;
    else if (value?.kind === "array") returnsRecords = true;
    else return null;
  }
  if (!returnsHtml || !returnsRecords) return null;
  for (const entry of proof.callbacks) {
    const fn = entry.callback;
    if (
      !isFunctionLike(fn) ||
      fn.async ||
      fn.generator ||
      !isNodeOfType(fn.body, "BlockStatement") ||
      fn.params.length > OWNED_RENDERER_BUILDER_CONTAINER_COUNT
    )
      return null;
    const values = new Map(proof.values);
    const [parameter] = fn.params;
    if (isNodeOfType(parameter, "Identifier")) {
      const symbol = context.module.scopes.symbolFor(parameter);
      if (!symbol) return null;
      values.set(symbol, { kind: "token", methodName: entry.methodName });
    } else if (isNodeOfType(parameter, "ObjectPattern")) {
      for (const property of parameter.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          property.computed ||
          !isNodeOfType(property.value, "Identifier")
        )
          return null;
        const symbol = context.module.scopes.symbolFor(property.value);
        const name = propertyName(property, proof);
        const field = name && tokenField(entry.methodName, name);
        if (!symbol || !field) return null;
        values.set(symbol, field);
      }
    } else if (parameter) return null;
    if (!callbackBody(fn.body.body, values, proof, entry, false, 0)) return null;
  }
  for (const symbol of proof.owned)
    if (
      symbol.references.some(
        (reference) =>
          reference.flag !== "read" ||
          !proof.allowed.has(reference.identifier) ||
          !isAstDescendant(reference.identifier, wrapper),
      )
    )
      return null;
  for (const symbol of proof.helpers.keys())
    if (
      symbol.references.some(
        (reference) => reference.flag !== "read" || !proof.allowed.has(reference.identifier),
      )
    )
      return null;
  const instanceSymbols = [...(context.module.scopes.ownScopeFor(wrapper)?.symbols ?? [])].filter(
    (symbol) => {
      const init = getDirectConstInitializer(symbol);
      return init && context.getInstance(init) === proof.instance;
    },
  );
  for (const symbol of instanceSymbols)
    if (symbol.references.some((reference) => !proof.allowed.has(reference.identifier)))
      return null;
  if (!hasSupportedSourceIntrinsicUses(context)) return null;
  return {
    captures: proof.owned,
    callbacks: new Set(proof.callbacks.map((entry) => entry.callback)),
  };
};
