import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { walkAst } from "./walk-ast.js";

type Node = EsTreeNode | null | undefined;
type Role = "actions" | "createPage" | "createRedirect" | "graphql" | "page";
type Call = EsTreeNodeOfType<"CallExpression">;
type Arrow = EsTreeNodeOfType<"ArrowFunctionExpression">;
type Member = EsTreeNodeOfType<"MemberExpression">;
type Ident = EsTreeNodeOfType<"Identifier">;
type QueryEvidence = {
  readonly query: string;
  readonly resultField: string;
  readonly frontmatterKey: string;
};

interface GatsbyV1IndexPageInput {
  readonly program: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
  /**
   * Must establish the effective, unmodified built-in/installed provider for each require.
   * A dependency version declaration alone does not suffice.
   */
  readonly isStockRequire: (specifier: string) => boolean;
  /**
   * Must establish that every reachable value from the selected literal GraphQL query,
   * source inputs, and plugins is present in the returned set of strings.
   * Return null if the graph or effective data provider is opaque.
   */
  readonly readClosedFrontmatterPaths: (query: QueryEvidence) => readonly string[] | null;
}

const SAFE_ROOT = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/u;
const SAFE_SEGMENT_TEXT = /^[A-Za-z0-9_/-]*$/u;
const STOCK_REQUIRES = new Set(["path", "node:path", "date-fns", "lodash"]);
const STOCK_LODASH_METHODS = new Set(["sortBy", "deburr", "lowerCase", "kebabCase"]);
const SAFE_LAYOUT = /^[A-Za-z0-9_-]+$/u;
const FORBIDDEN_PROPERTIES = new Set(["constructor", "prototype", "__proto__", "caller", "callee"]);

const namedMember = <Name extends string>(
  node: Node,
  name: Name,
): node is Member & { property: Ident & { name: Name } } =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === name;

const directCall = (node: Node): node is Call =>
  isNodeOfType(node, "CallExpression") && !node.optional;

const getString = getStaticStringExpression;

const getSlots = (node: Node): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression") && !isNodeOfType(node, "ObjectPattern")) return null;
  const slots = new Map<string, EsTreeNode>();
  for (const entry of node.properties) {
    if (!isNodeOfType(entry, "Property") || entry.computed || entry.kind !== "init" || entry.method)
      return null;
    const key = isNodeOfType(entry.key, "Identifier") ? entry.key.name : getString(entry.key);
    if (key === null || FORBIDDEN_PROPERTIES.has(key) || slots.has(key)) return null;
    slots.set(key, entry.value);
  }
  return slots;
};

const getRuntimeReferences = (symbol: SymbolDescriptor) =>
  symbol.references.filter(({ identifier }) => {
    const property = identifier.parent;
    // The scope visitor can also report the non-value key of a shorthand
    // destructuring declaration. Ignore only the key paired to this binding.
    return !(
      isNodeOfType(property, "Property") &&
      property.shorthand &&
      property.key === identifier &&
      property.value === symbol.bindingIdentifier &&
      isNodeOfType(property.parent, "ObjectPattern")
    );
  });

const isNonRootLiteral = (value: string | null): value is string =>
  value !== null && SAFE_ROOT.test(value) && !/^\/index\/?$/iu.test(value);

const matchDirectReceiver = (receiver: Node, name: string): Call | null => {
  const member = receiver?.parent;
  return namedMember(member, name) &&
    member.object === receiver &&
    directCall(member.parent) &&
    member.parent.callee === member
    ? member.parent
    : null;
};

const thenOrForEach = (arrow: Arrow, name: string): Member | null => {
  const call = arrow.parent;
  return directCall(call) &&
    call.arguments.length === 1 &&
    call.arguments[0] === arrow &&
    namedMember(call.callee, name)
    ? call.callee
    : null;
};

const hookExport = (statement: EsTreeNode, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const assignment = statement.expression;
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=") return null;
  for (const name of ["createPages", "onCreatePage"] as const) {
    if (
      namedMember(assignment.left, name) &&
      isNodeOfType(assignment.left.object, "Identifier") &&
      assignment.left.object.name === "exports" &&
      scopes.isGlobalReference(assignment.left.object) &&
      isNodeOfType(assignment.right, "ArrowFunctionExpression") &&
      assignment.right.params.length === 1
    ) {
      return { name, arrow: assignment.right, allowedGlobal: assignment.left.object };
    }
  }
  return null;
};

/**
 * Page-action lemma only. The caller separately proves Gatsby v1 default layout semantics,
 * plugin/config allowlists, no alternate loader or renderer, and effective package roots.
 */
export const preservesStockGatsbyV1IndexPage = ({
  program,
  scopes,
  isStockRequire,
  readClosedFrontmatterPaths,
}: GatsbyV1IndexPageInput): boolean => {
  const allowedGlobals = new Set<EsTreeNode>();
  const knownProviders = new Map<SymbolDescriptor, string>();
  const localHelpers = new Map<SymbolDescriptor, Arrow>();
  const roles = new Map<SymbolDescriptor, Role>();
  const work: Array<[SymbolDescriptor, Role]> = [];
  const pendingActions: Array<{ role: "createPage" | "createRedirect"; call: Call }> = [];
  const pageRoles: Array<SymbolDescriptor> = [];
  const hooks = new Set<string>();
  const remember = (node: Node, role: Role): boolean => {
    if (!isNodeOfType(node, "Identifier")) return false;
    const symbol = scopes.symbolFor(node);
    if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return false;
    const previous = roles.get(symbol);
    if (previous !== undefined) return previous === role;
    roles.set(symbol, role);
    work.push([symbol, role]);
    return true;
  };
  const getIdentifierBinding = (node: Node): SymbolDescriptor | null =>
    isNodeOfType(node, "Identifier") ? scopes.symbolFor(node) : null;
  const matchesRole = (node: Node, role: Role): boolean => {
    const symbol = getIdentifierBinding(node);
    return symbol !== null && roles.get(symbol) === role;
  };

  for (const statement of program.body) {
    const hook = hookExport(statement, scopes);
    if (hook) {
      if (hooks.has(hook.name)) return false;
      hooks.add(hook.name);
      allowedGlobals.add(hook.allowedGlobal);
      const slots = getSlots(hook.arrow.params[0]);
      if (!slots || !slots.has("boundActionCreators")) return false;
      for (const [name, binding] of slots) {
        const role =
          name === "boundActionCreators"
            ? "actions"
            : name === "graphql" && hook.name === "createPages"
              ? "graphql"
              : name === "page" && hook.name === "onCreatePage"
                ? "page"
                : null;
        if (!role || !remember(binding, role)) return false;
      }
      continue;
    }
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return false;
    for (const declaration of statement.declarations) {
      const initializer = declaration.init;
      if (
        isNodeOfType(declaration.id, "Identifier") &&
        isNodeOfType(initializer, "ArrowFunctionExpression")
      ) {
        const symbol = scopes.symbolFor(declaration.id);
        if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return false;
        localHelpers.set(symbol, initializer);
        continue;
      }
      if (
        !directCall(initializer) ||
        !isNodeOfType(initializer.callee, "Identifier") ||
        initializer.callee.name !== "require" ||
        !scopes.isGlobalReference(initializer.callee) ||
        initializer.arguments.length !== 1
      )
        return false;
      const specifier = getString(initializer.arguments[0]);
      if (!specifier || !STOCK_REQUIRES.has(specifier) || !isStockRequire(specifier)) return false;
      allowedGlobals.add(initializer.callee);
      const bindings = getSlots(declaration.id);
      if (specifier === "lodash") {
        if (!bindings || bindings.size === 0) return false;
        for (const [key, binding] of bindings) {
          if (!STOCK_LODASH_METHODS.has(key) || !isNodeOfType(binding, "Identifier")) return false;
          const symbol = scopes.symbolFor(binding);
          if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return false;
          knownProviders.set(symbol, key);
        }
      } else {
        if (!isNodeOfType(declaration.id, "Identifier")) return false;
        const symbol = scopes.symbolFor(declaration.id);
        if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return false;
        knownProviders.set(symbol, specifier);
      }
    }
  }

  const provider = (node: Node): string | undefined => {
    const symbol = getIdentifierBinding(node);
    return symbol ? knownProviders.get(symbol) : undefined;
  };

  for (const [symbol, providerName] of knownProviders) {
    for (const { identifier, flag } of getRuntimeReferences(symbol)) {
      if (flag !== "read") return false;
      if (providerName === "path" || providerName === "node:path" || providerName === "date-fns") {
        const member = providerName === "date-fns" ? "format" : "resolve";
        if (!matchDirectReceiver(identifier, member)) return false;
      } else if (!directCall(identifier.parent) || identifier.parent.callee !== identifier) {
        return false;
      }
    }
  }
  for (const helper of localHelpers.keys()) {
    if (
      getRuntimeReferences(helper).some(
        ({ identifier, flag }) =>
          flag !== "read" ||
          !directCall(identifier.parent) ||
          identifier.parent.callee !== identifier,
      )
    )
      return false;
  }

  const resolveConst = (node: Node): Node => {
    if (!isNodeOfType(node, "Identifier")) return node;
    const symbol = scopes.symbolFor(node);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier ||
      !hasCompleteSymbolReferences(symbol, program, scopes) ||
      getRuntimeReferences(symbol).some(
        ({ identifier, flag }) => flag !== "read" || isWithinAssignmentTarget(identifier),
      )
    )
      return null;
    return symbol.initializer;
  };
  // Only the two explicitly seeded actions may receive or carry Gatsby authority.
  for (let index = 0; index < work.length; index++) {
    const [symbol, role] = work[index];
    if (role === "page") {
      pageRoles.push(symbol);
      continue;
    }
    for (const { identifier, flag } of getRuntimeReferences(symbol)) {
      if (flag !== "read") return false;
      const call = identifier.parent;
      if (role === "actions") {
        if (
          !isNodeOfType(call, "VariableDeclarator") ||
          call.init !== identifier ||
          !isNodeOfType(call.parent, "VariableDeclaration") ||
          call.parent.kind !== "const"
        )
          return false;
        const slots = getSlots(call.id);
        if (!slots || slots.size === 0) return false;
        for (const [key, binding] of slots) {
          if ((key !== "createPage" && key !== "createRedirect") || !remember(binding, key))
            return false;
        }
      } else if (!directCall(call)) {
        return false;
      } else if (call.callee === identifier) {
        if (call.arguments.length !== 1) return false;
        if (role === "graphql") {
          if (getString(resolveConst(call.arguments[0])) === null) return false;
        } else {
          pendingActions.push({ role, call });
        }
      } else {
        const callee = getIdentifierBinding(call.callee);
        const helper = callee && localHelpers.get(callee);
        const argumentIndex = call.arguments.findIndex((argument) => argument === identifier);
        if (!helper || argumentIndex < 0 || !remember(helper.params[argumentIndex], role))
          return false;
      }
    }
  }

  const resolveMemberChain = (node: Node, names: readonly string[]): Node => {
    let current = node;
    for (let index = names.length - 1; index >= 0; index--) {
      if (!namedMember(current, names[index])) return null;
      current = current.object;
    }
    return current;
  };
  const onlyReadUses = (binding: Node, allowed: (identifier: EsTreeNode) => boolean): boolean => {
    if (!isNodeOfType(binding, "Identifier")) return false;
    const symbol = scopes.symbolFor(binding);
    return (
      symbol !== null &&
      hasCompleteSymbolReferences(symbol, program, scopes) &&
      getRuntimeReferences(symbol).every(
        ({ identifier, flag }) =>
          flag === "read" && !isWithinAssignmentTarget(identifier) && allowed(identifier),
      )
    );
  };
  const isNavigationRead = (node: EsTreeNode): boolean => {
    const call = matchDirectReceiver(node, "map");
    const arrow = call?.arguments[0];
    if (
      call?.arguments.length !== 1 ||
      !isNodeOfType(arrow, "ArrowFunctionExpression") ||
      arrow.params.length !== 1 ||
      !namedMember(arrow.body, "frontmatter")
    )
      return false;
    const item = getSlots(arrow.params[0])?.get("node");
    if (
      !item ||
      !isNodeOfType(item, "Identifier") ||
      !isNodeOfType(arrow.body.object, "Identifier") ||
      scopes.symbolFor(item) !== scopes.symbolFor(arrow.body.object)
    )
      return false;
    const sorter = call.parent;
    return (
      directCall(sorter) &&
      provider(sorter.callee) === "sortBy" &&
      sorter.arguments.length === 2 &&
      sorter.arguments[0] === call &&
      getString(sorter.arguments[1]) === "position"
    );
  };
  const isClosedFrontmatterPath = (node: Node): boolean => {
    const item = resolveMemberChain(node, ["frontmatter", "path"]);
    if (!isNodeOfType(item, "Identifier")) return false;
    if (!onlyReadUses(item, (identifier) => identifier === item)) return false;
    const binding = scopes.symbolFor(item)?.bindingIdentifier;
    const property = binding?.parent;
    const pattern = property?.parent;
    const callback = pattern?.parent;
    if (
      !isNodeOfType(property, "Property") ||
      !isNodeOfType(pattern, "ObjectPattern") ||
      getSlots(pattern)?.get("node") !== binding ||
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      callback.params[0] !== pattern
    )
      return false;
    const forEach = thenOrForEach(callback, "forEach");
    if (
      !forEach ||
      !onlyReadUses(
        forEach.object,
        (identifier) => identifier === forEach.object || isNavigationRead(identifier),
      )
    )
      return false;
    const edges = resolveConst(forEach.object);
    if (
      !namedMember(edges, "edges") ||
      !namedMember(edges.object, "allMarkdownRemark") ||
      !namedMember(edges.object.object, "data") ||
      !isNodeOfType(edges.object.object.object, "Identifier")
    )
      return false;
    const selectedResult = edges.object.object.object;
    if (
      !onlyReadUses(selectedResult, (identifier) => {
        if (identifier === selectedResult) return true;
        const member = identifier.parent;
        if (!namedMember(member, "errors")) return false;
        const parent = member.parent;
        return (
          (isNodeOfType(parent, "IfStatement") && parent.test === member) ||
          (directCall(parent) &&
            parent.arguments.length === 1 &&
            parent.arguments[0] === member &&
            namedMember(parent.callee, "reject") &&
            isNodeOfType(parent.callee.object, "Identifier") &&
            parent.callee.object.name === "Promise" &&
            scopes.isGlobalReference(parent.callee.object))
        );
      })
    )
      return false;
    const resultBinding = scopes.symbolFor(selectedResult)?.bindingIdentifier;
    const thenArrow = resultBinding?.parent;
    if (
      !isNodeOfType(thenArrow, "ArrowFunctionExpression") ||
      thenArrow.params[0] !== resultBinding
    )
      return false;
    const then = thenOrForEach(thenArrow, "then");
    const queryCall = then?.object;
    if (
      !directCall(queryCall) ||
      !matchesRole(queryCall.callee, "graphql") ||
      queryCall.arguments.length !== 1
    )
      return false;
    const query = getString(resolveConst(queryCall.arguments[0]));
    if (query === null) return false;
    const paths = readClosedFrontmatterPaths({
      query,
      resultField: "allMarkdownRemark",
      frontmatterKey: "path",
    });
    return paths !== null && paths.every(isNonRootLiteral);
  };

  const isStockSlug = (node: Node): boolean => {
    if (
      !directCall(node) ||
      !isNodeOfType(node.callee, "Identifier") ||
      node.arguments.length !== 1
    )
      return false;
    const callee = getIdentifierBinding(node.callee);
    const helper = callee ? localHelpers.get(callee) : undefined;
    let expression: Node = helper?.body;
    for (const name of ["kebabCase", "lowerCase", "deburr"]) {
      if (
        !directCall(expression) ||
        provider(expression.callee) !== name ||
        expression.arguments.length !== 1
      )
        return false;
      expression = expression.arguments[0];
    }
    return (
      isNodeOfType(expression, "Identifier") &&
      helper?.params.length === 1 &&
      scopes.symbolFor(expression) === scopes.symbolFor(helper.params[0])
    );
  };
  const isStockDatePath = (node: Node): boolean => {
    if (
      !directCall(node) ||
      !namedMember(node.callee, "format") ||
      provider(node.callee.object) !== "date-fns" ||
      node.arguments.length !== 2 ||
      getString(node.arguments[1]) !== "YYYY/MM/DD"
    )
      return false;
    const date = resolveConst(node.arguments[0]);
    return (
      isNodeOfType(date, "NewExpression") &&
      isNodeOfType(date.callee, "Identifier") &&
      date.callee.name === "Date" &&
      scopes.isGlobalReference(date.callee) &&
      date.arguments.length === 1
    );
  };
  const isNonRootPath = (node: Node): boolean => {
    if (isNonRootLiteral(getString(node))) return true;
    if (!isNodeOfType(node, "TemplateLiteral") || node.expressions.length === 0)
      return isClosedFrontmatterPath(node);
    const parts = node.quasis.map((chunk) => chunk.value.cooked ?? chunk.value.raw);
    return (
      /^\/(?!index(?:\/|$))[A-Za-z0-9_-]+\//iu.test(parts[0] ?? "") &&
      parts.every((part) => SAFE_SEGMENT_TEXT.test(part)) &&
      node.expressions.every((expression) => isStockDatePath(expression) || isStockSlug(expression))
    );
  };

  const isPagePath = (
    node: Node,
    page: SymbolDescriptor,
  ): node is Member & { property: Ident & { name: "path" } } =>
    namedMember(node, "path") &&
    isNodeOfType(node.object, "Identifier") &&
    scopes.symbolFor(node.object) === page;
  const isBoundedPathGuard = (test: Node, page: SymbolDescriptor): boolean => {
    if (isNodeOfType(test, "BinaryExpression") && test.operator === "===") {
      return (
        (isPagePath(test.left, page) && isNonRootLiteral(getString(test.right))) ||
        (isPagePath(test.right, page) && isNonRootLiteral(getString(test.left)))
      );
    }
    if (!directCall(test) || test.arguments.length !== 1) return false;
    if (namedMember(test.callee, "startsWith")) {
      const prefix = getString(test.arguments[0]);
      return (
        isPagePath(test.callee.object, page) && isNonRootLiteral(prefix) && prefix.endsWith("/")
      );
    }
    const pattern = test.arguments[0];
    return (
      namedMember(test.callee, "match") &&
      isPagePath(test.callee.object, page) &&
      isNodeOfType(pattern, "Literal") &&
      "regex" in pattern &&
      pattern.regex?.flags === "" &&
      /^\\\/[A-Za-z0-9_-]+$/u.test(pattern.regex.pattern)
    );
  };
  const isGuarded = (node: EsTreeNode, page: SymbolDescriptor): boolean => {
    let parent = node.parent;
    let child = node;
    while (parent) {
      if (
        isNodeOfType(parent, "IfStatement") &&
        parent.consequent === child &&
        isBoundedPathGuard(parent.test, page)
      )
        return true;
      if (isFunctionLike(parent)) return false;
      child = parent;
      parent = parent.parent;
    }
    return false;
  };

  const checkedPageReferences = new Set<EsTreeNode>();
  for (const { role, call } of pendingActions) {
    const arg = call.arguments[0];
    const page = isNodeOfType(arg, "Identifier") ? scopes.symbolFor(arg) : null;
    if (isNodeOfType(arg, "Identifier") && page && roles.get(page) === "page") {
      if (role !== "createPage" || !isGuarded(call, page)) return false;
      checkedPageReferences.add(arg);
      continue;
    }
    if (
      isNodeOfType(arg, "Identifier") &&
      !onlyReadUses(arg, (identifier) => {
        if (identifier === arg) return true;
        const member = identifier.parent;
        const entry = member?.parent;
        const redirect = entry?.parent?.parent;
        return (
          namedMember(member, "path") &&
          isNodeOfType(entry, "Property") &&
          entry.value === member &&
          !entry.computed &&
          isNodeOfType(entry.key, "Identifier") &&
          entry.key.name === "toPath" &&
          directCall(redirect) &&
          redirect.arguments.length === 1 &&
          redirect.arguments[0] === entry.parent &&
          matchesRole(redirect.callee, "createRedirect")
        );
      })
    )
      return false;
    const slots = getSlots(resolveConst(arg));
    if (!slots) return false;
    if (role === "createRedirect") {
      if (!isNonRootPath(slots.get("fromPath"))) return false;
    } else if (!isNonRootPath(slots.get("path"))) {
      return false;
    }
    const layout = slots.get("layout");
    if (layout && !SAFE_LAYOUT.test(getString(layout) ?? "")) return false;
  }
  for (const page of pageRoles) {
    for (const { identifier, flag } of getRuntimeReferences(page)) {
      if (flag !== "read") return false;
      if (checkedPageReferences.has(identifier)) continue;
      const member = identifier.parent;
      if (isPagePath(member, page) && !isWithinAssignmentTarget(member)) {
        if (
          isBoundedPathGuard(member.parent, page) ||
          (namedMember(member.parent, "match") && isBoundedPathGuard(member.parent.parent, page)) ||
          (namedMember(member.parent, "startsWith") &&
            isBoundedPathGuard(member.parent.parent, page))
        )
          continue;
      }
      if (
        namedMember(member, "layout") &&
        member.object === identifier &&
        isNodeOfType(member.parent, "AssignmentExpression") &&
        member.parent.left === member &&
        member.parent.operator === "=" &&
        SAFE_LAYOUT.test(getString(member.parent.right) ?? "") &&
        isGuarded(member.parent, page)
      )
        continue;
      return false;
    }
  }

  let opaque = false;
  walkAst(program, (node) => {
    if (opaque) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TaggedTemplateExpression") ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "MemberExpression") &&
        (node.computed ||
          (isNodeOfType(node.property, "Identifier") &&
            FORBIDDEN_PROPERTIES.has(node.property.name))))
    ) {
      opaque = true;
      return false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      !scopes.isGlobalReference(node) ||
      allowedGlobals.has(node)
    )
      return;
    const parent = node.parent;
    opaque = !(
      node.name === "undefined" ||
      (node.name === "Promise" &&
        ((isNodeOfType(parent, "NewExpression") && parent.callee === node) ||
          matchDirectReceiver(node, "all") !== null ||
          matchDirectReceiver(node, "reject") !== null)) ||
      (node.name === "Date" && isNodeOfType(parent, "NewExpression") && parent.callee === node)
    );
  });
  return !opaque;
};
