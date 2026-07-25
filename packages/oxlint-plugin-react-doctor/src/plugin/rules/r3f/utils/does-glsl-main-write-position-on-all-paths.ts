import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type {
  AstNode,
  CompoundStatementNode,
  FunctionNode,
  Program,
} from "@shaderfrog/glsl-parser/ast/ast-types.js";
import { getGlslFunctionCallName } from "./get-glsl-function-call-name.js";
import { hasGlslFunctionDeclaration } from "./has-glsl-function-declaration.js";

export interface GlslPositionPathAnalysis {
  readonly mainFunction: FunctionNode | null;
  readonly writesPositionOnAllPaths: boolean | null;
}

interface PositionExecutionResult {
  readonly activeStates: ReadonlySet<boolean>;
  readonly hasUnwrittenReturn: boolean;
  readonly isSupported: boolean;
}

const doesExpressionDefinitelyWritePosition = (expression: AstNode): boolean => {
  if (
    expression.type === "assignment" &&
    expression.operator.literal === "=" &&
    expression.left.type === "identifier" &&
    expression.left.identifier === "gl_Position"
  ) {
    return true;
  }
  if (expression.type === "group") {
    return doesExpressionDefinitelyWritePosition(expression.expression);
  }
  if (expression.type === "ternary") {
    return (
      doesExpressionDefinitelyWritePosition(expression.left) &&
      doesExpressionDefinitelyWritePosition(expression.right)
    );
  }
  return false;
};

const getBooleanConstant = (expression: AstNode): boolean | null => {
  if (expression.type !== "bool_constant") return null;
  return expression.token === "true";
};

const analyzeCompoundStatement = (
  statement: CompoundStatementNode,
  inputStates: ReadonlySet<boolean>,
): PositionExecutionResult => {
  let activeStates = inputStates;
  let hasUnwrittenReturn = false;
  for (const child of statement.statements) {
    if (activeStates.size === 0) break;
    const childResult = analyzeStatement(child, activeStates);
    if (!childResult.isSupported) return childResult;
    activeStates = childResult.activeStates;
    hasUnwrittenReturn ||= childResult.hasUnwrittenReturn;
  }
  return { activeStates, hasUnwrittenReturn, isSupported: true };
};

const analyzeStatement = (
  statement: AstNode,
  inputStates: ReadonlySet<boolean>,
): PositionExecutionResult => {
  if (statement.type === "compound_statement") {
    return analyzeCompoundStatement(statement, inputStates);
  }
  if (statement.type === "expression_statement") {
    return {
      activeStates: doesExpressionDefinitelyWritePosition(statement.expression)
        ? new Set([true])
        : inputStates,
      hasUnwrittenReturn: false,
      isSupported: true,
    };
  }
  if (statement.type === "return_statement") {
    return {
      activeStates: new Set(),
      hasUnwrittenReturn: inputStates.has(false),
      isSupported: true,
    };
  }
  if (statement.type === "if_statement") {
    const constantCondition = getBooleanConstant(statement.condition);
    const consequent = analyzeStatement(statement.body, inputStates);
    if (!consequent.isSupported) return consequent;
    const alternateNodes = Reflect.get(statement, "else");
    const alternateStatement = Array.isArray(alternateNodes)
      ? alternateNodes[alternateNodes.length - 1]
      : undefined;
    const alternate = alternateStatement
      ? analyzeStatement(alternateStatement, inputStates)
      : {
          activeStates: inputStates,
          hasUnwrittenReturn: false,
          isSupported: true,
        };
    if (!alternate.isSupported) return alternate;
    if (constantCondition !== null) return constantCondition ? consequent : alternate;
    return {
      activeStates: new Set([...consequent.activeStates, ...alternate.activeStates]),
      hasUnwrittenReturn: consequent.hasUnwrittenReturn || alternate.hasUnwrittenReturn,
      isSupported: true,
    };
  }
  if (statement.type === "for_statement" || statement.type === "while_statement") {
    const bodyResult = analyzeStatement(statement.body, inputStates);
    return {
      activeStates: inputStates,
      hasUnwrittenReturn: bodyResult.hasUnwrittenReturn,
      isSupported: bodyResult.isSupported,
    };
  }
  if (
    statement.type === "do_statement" ||
    statement.type === "switch_statement" ||
    statement.type === "break_statement" ||
    statement.type === "continue_statement"
  ) {
    return {
      activeStates: inputStates,
      hasUnwrittenReturn: false,
      isSupported: false,
    };
  }
  return {
    activeStates: inputStates,
    hasUnwrittenReturn: false,
    isSupported: true,
  };
};

const callsUserDefinedFunction = (mainFunction: FunctionNode, program: Program): boolean => {
  let callsFunction = false;
  visit(mainFunction.body, {
    function_call: {
      enter: ({ node }) => {
        const functionName = getGlslFunctionCallName(node);
        if (functionName && hasGlslFunctionDeclaration(program, functionName)) {
          callsFunction = true;
        }
      },
    },
  });
  return callsFunction;
};

export const doesGlslMainWritePositionOnAllPaths = (
  program: Program,
  source: string,
): GlslPositionPathAnalysis => {
  const mainFunction =
    program.program.find(
      (node): node is FunctionNode =>
        node.type === "function" && node.prototype.header.name.identifier === "main",
    ) ?? null;
  if (
    !mainFunction ||
    /^[ \t]*#[ \t]*define\b/m.test(source) ||
    callsUserDefinedFunction(mainFunction, program)
  ) {
    return { mainFunction, writesPositionOnAllPaths: null };
  }
  const result = analyzeCompoundStatement(mainFunction.body, new Set([false]));
  if (!result.isSupported) {
    return { mainFunction, writesPositionOnAllPaths: null };
  }
  return {
    mainFunction,
    writesPositionOnAllPaths: !result.hasUnwrittenReturn && !result.activeStates.has(false),
  };
};
