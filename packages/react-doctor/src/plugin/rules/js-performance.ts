import {
  CHAINABLE_ITERATION_METHODS,
  DEEP_NESTING_THRESHOLD,
  DUPLICATE_STORAGE_READ_THRESHOLD,
  SEQUENTIAL_AWAIT_THRESHOLD,
  STORAGE_OBJECTS,
  TEST_FILE_PATTERN,
} from "../constants.js";
import { createLoopAwareVisitors, isMemberProperty, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const jsCombineIterations: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
        return;

      const outerMethod = node.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(outerMethod)) return;

      const innerCall = node.callee.object;
      if (
        innerCall?.type !== "CallExpression" ||
        innerCall.callee?.type !== "MemberExpression" ||
        innerCall.callee.property?.type !== "Identifier"
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(innerMethod)) return;

      if (innerMethod === "map" && outerMethod === "filter") return;

      context.report({
        node,
        message: `.${innerMethod}().${outerMethod}() iterates the array twice — combine into a single loop with .reduce() or for...of`,
      });
    },
  }),
};

export const jsTosortedImmutable: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isMemberProperty(node.callee, "sort")) return;

      const receiver = node.callee.object;
      if (
        receiver?.type === "ArrayExpression" &&
        receiver.elements?.length === 1 &&
        receiver.elements[0]?.type === "SpreadElement"
      ) {
        context.report({
          node,
          message: "[...array].sort() — use array.toSorted() for immutable sorting (ES2023)",
        });
      }
    },
  }),
};

export const jsHoistRegexp: Rule = {
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      NewExpression(node: EsTreeNode) {
        if (node.callee?.type === "Identifier" && node.callee.name === "RegExp") {
          context.report({
            node,
            message: "new RegExp() inside a loop — hoist to a module-level constant",
          });
        }
      },
    }),
};

export const jsMinMaxLoop: Rule = {
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNode) {
      if (!node.computed) return;

      const object = node.object;
      if (object?.type !== "CallExpression" || !isMemberProperty(object.callee, "sort")) return;

      const isFirstElement = node.property?.type === "Literal" && node.property.value === 0;
      const isLastElement =
        node.property?.type === "BinaryExpression" &&
        node.property.operator === "-" &&
        node.property.right?.type === "Literal" &&
        node.property.right.value === 1;

      if (isFirstElement || isLastElement) {
        const targetFunction = isFirstElement ? "min" : "max";
        context.report({
          node,
          message: `array.sort()[${isFirstElement ? "0" : "length-1"}] for min/max — use Math.${targetFunction}(...array) instead (O(n) vs O(n log n))`,
        });
      }
    },
  }),
};

export const jsSetMapLookups: Rule = {
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNode) {
        if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
          return;
        const methodName = node.callee.property.name;
        if (methodName === "includes" || methodName === "indexOf") {
          context.report({
            node,
            message: `array.${methodName}() in a loop is O(n) per call — convert to a Set for O(1) lookups`,
          });
        }
      },
    }),
};

export const jsBatchDomCss: Rule = {
  create: (context: RuleContext) => {
    const isStyleAssignment = (node: EsTreeNode): boolean =>
      node.type === "ExpressionStatement" &&
      node.expression?.type === "AssignmentExpression" &&
      node.expression.left?.type === "MemberExpression" &&
      node.expression.left.object?.type === "MemberExpression" &&
      node.expression.left.object.property?.type === "Identifier" &&
      node.expression.left.object.property.name === "style";

    return {
      BlockStatement(node: EsTreeNode) {
        const statements = node.body ?? [];
        for (let statementIndex = 1; statementIndex < statements.length; statementIndex++) {
          if (
            isStyleAssignment(statements[statementIndex]) &&
            isStyleAssignment(statements[statementIndex - 1])
          ) {
            context.report({
              node: statements[statementIndex],
              message:
                "Multiple sequential element.style assignments — batch with cssText or classList for fewer reflows",
            });
          }
        }
      },
    };
  },
};

export const jsIndexMaps: Rule = {
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNode) {
        if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
          return;
        const methodName = node.callee.property.name;
        if (methodName === "find" || methodName === "findIndex") {
          context.report({
            node,
            message: `array.${methodName}() in a loop is O(n*m) — build a Map for O(1) lookups`,
          });
        }
      },
    }),
};

export const jsCacheStorage: Rule = {
  create: (context: RuleContext) => {
    const storageReadCounts = new Map<string, number>();

    return {
      CallExpression(node: EsTreeNode) {
        if (!isMemberProperty(node.callee, "getItem")) return;
        if (
          node.callee.object?.type !== "Identifier" ||
          !STORAGE_OBJECTS.has(node.callee.object.name)
        )
          return;
        if (node.arguments?.[0]?.type !== "Literal") return;

        const storageKey = String(node.arguments[0].value);
        const readCount = (storageReadCounts.get(storageKey) ?? 0) + 1;
        storageReadCounts.set(storageKey, readCount);

        if (readCount === DUPLICATE_STORAGE_READ_THRESHOLD) {
          const storageName = node.callee.object.name;
          context.report({
            node,
            message: `${storageName}.getItem("${storageKey}") called multiple times — cache the result in a variable`,
          });
        }
      },
    };
  },
};

export const jsEarlyExit: Rule = {
  create: (context: RuleContext) => ({
    IfStatement(node: EsTreeNode) {
      if (node.consequent?.type !== "BlockStatement" || !node.consequent.body) return;

      let nestingDepth = 0;
      let currentBlock = node.consequent;
      while (currentBlock?.type === "BlockStatement" && currentBlock.body?.length === 1) {
        const innerStatement = currentBlock.body[0];
        if (innerStatement.type !== "IfStatement") break;
        nestingDepth++;
        currentBlock = innerStatement.consequent;
      }

      if (nestingDepth >= DEEP_NESTING_THRESHOLD) {
        context.report({
          node,
          message: `${nestingDepth + 1} levels of nested if statements — use early returns to flatten`,
        });
      }
    },
  }),
};

export const asyncParallel: Rule = {
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isTestFile = TEST_FILE_PATTERN.test(filename);

    return {
      BlockStatement(node: EsTreeNode) {
        if (isTestFile) return;
        const consecutiveAwaitStatements: EsTreeNode[] = [];

        const flushConsecutiveAwaits = (): void => {
          if (consecutiveAwaitStatements.length >= SEQUENTIAL_AWAIT_THRESHOLD) {
            reportIfIndependent(consecutiveAwaitStatements, context);
          }
          consecutiveAwaitStatements.length = 0;
        };

        for (const statement of node.body ?? []) {
          const isAwaitStatement =
            (statement.type === "VariableDeclaration" &&
              statement.declarations?.length === 1 &&
              statement.declarations[0].init?.type === "AwaitExpression") ||
            (statement.type === "ExpressionStatement" &&
              statement.expression?.type === "AwaitExpression");

          if (isAwaitStatement) {
            consecutiveAwaitStatements.push(statement);
          } else {
            flushConsecutiveAwaits();
          }
        }
        flushConsecutiveAwaits();
      },
    };
  },
};

const reportIfIndependent = (statements: EsTreeNode[], context: RuleContext): void => {
  const declaredNames = new Set<string>();

  for (const statement of statements) {
    if (statement.type !== "VariableDeclaration") continue;
    const declarator = statement.declarations[0];
    const awaitArgument = declarator.init?.argument;

    let referencesEarlierResult = false;
    walkAst(awaitArgument, (child: EsTreeNode) => {
      if (child.type === "Identifier" && declaredNames.has(child.name)) {
        referencesEarlierResult = true;
      }
    });

    if (referencesEarlierResult) return;

    if (declarator.id?.type === "Identifier") {
      declaredNames.add(declarator.id.name);
    }
  }

  context.report({
    node: statements[0],
    message: `${statements.length} sequential await statements that appear independent — use Promise.all() for parallel execution`,
  });
};

export const jsFlatmapFilter: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
        return;

      const outerMethod = node.callee.property.name;
      if (outerMethod !== "filter") return;

      const filterArgument = node.arguments?.[0];
      if (!filterArgument) return;

      const isIdentityArrow =
        filterArgument.type === "ArrowFunctionExpression" &&
        filterArgument.params?.length === 1 &&
        filterArgument.body?.type === "Identifier" &&
        filterArgument.params[0]?.type === "Identifier" &&
        filterArgument.body.name === filterArgument.params[0].name;

      const isFilterBoolean =
        (filterArgument.type === "Identifier" && filterArgument.name === "Boolean") ||
        isIdentityArrow;

      if (!isFilterBoolean) return;

      const innerCall = node.callee.object;
      if (
        innerCall?.type !== "CallExpression" ||
        innerCall.callee?.type !== "MemberExpression" ||
        innerCall.callee.property?.type !== "Identifier"
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (innerMethod !== "map") return;

      context.report({
        node,
        message:
          ".map().filter(Boolean) iterates twice — use .flatMap() to transform and filter in a single pass",
      });
    },
  }),
};
