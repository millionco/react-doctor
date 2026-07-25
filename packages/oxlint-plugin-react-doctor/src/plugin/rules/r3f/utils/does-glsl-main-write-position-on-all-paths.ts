import { visit } from "@shaderfrog/glsl-parser/ast/index.js";
import type {
  AstNode,
  CompoundStatementNode,
  FunctionNode,
  Program,
} from "@shaderfrog/glsl-parser/ast/ast-types.js";
import {
  GLSL_ALL_POSITION_COMPONENTS_BIT_MASK,
  GLSL_NO_POSITION_COMPONENTS_BIT_MASK,
  GLSL_POSITION_COMPONENT_BIT_BY_ALIAS,
} from "../constants.js";
import { getGlslFunctionCallName } from "./get-glsl-function-call-name.js";
import { hasGlslFunctionDeclaration } from "./has-glsl-function-declaration.js";
import { maskGlslComments } from "./mask-glsl-comments.js";

export interface GlslPositionPathAnalysis {
  readonly mainFunction: FunctionNode | null;
  readonly writesPositionOnAllPaths: boolean | null;
}

interface PositionExecutionResult {
  readonly activeStates: ReadonlySet<number>;
  readonly hasUnwrittenReturn: boolean;
  readonly isSupported: boolean;
}

const getPositionSwizzleWriteMask = (selection: string): number => {
  let writeMask = GLSL_NO_POSITION_COMPONENTS_BIT_MASK;
  for (const componentAlias of selection) {
    const componentBit = GLSL_POSITION_COMPONENT_BIT_BY_ALIAS.get(componentAlias);
    if (!componentBit) return GLSL_NO_POSITION_COMPONENTS_BIT_MASK;
    writeMask |= componentBit;
  }
  return writeMask;
};

const getExpressionPositionWriteMask = (expression: AstNode): number => {
  if (expression.type === "assignment" && expression.operator.literal === "=") {
    if (expression.left.type === "identifier" && expression.left.identifier === "gl_Position") {
      return GLSL_ALL_POSITION_COMPONENTS_BIT_MASK;
    }
    if (
      expression.left.type === "postfix" &&
      expression.left.expression.type === "identifier" &&
      expression.left.expression.identifier === "gl_Position" &&
      expression.left.postfix.type === "field_selection"
    ) {
      const selection = Reflect.get(expression.left.postfix.selection, "identifier");
      return typeof selection === "string"
        ? getPositionSwizzleWriteMask(selection)
        : GLSL_NO_POSITION_COMPONENTS_BIT_MASK;
    }
  }
  if (expression.type === "binary" && expression.operator.literal === ",") {
    return (
      getExpressionPositionWriteMask(expression.left) |
      getExpressionPositionWriteMask(expression.right)
    );
  }
  if (expression.type === "group") {
    return getExpressionPositionWriteMask(expression.expression);
  }
  if (expression.type === "ternary") {
    return (
      getExpressionPositionWriteMask(expression.left) &
      getExpressionPositionWriteMask(expression.right)
    );
  }
  return GLSL_NO_POSITION_COMPONENTS_BIT_MASK;
};

const expressionContainsPositionWrite = (expression: AstNode): boolean => {
  let containsPositionWrite = false;
  visit(expression, {
    assignment: {
      enter: ({ node }) => {
        if (getExpressionPositionWriteMask(node) !== GLSL_NO_POSITION_COMPONENTS_BIT_MASK) {
          containsPositionWrite = true;
        }
      },
    },
  });
  return containsPositionWrite;
};

const getBooleanConstant = (expression: AstNode): boolean | null => {
  if (expression.type !== "bool_constant") return null;
  return expression.token === "true";
};

const analyzeCompoundStatement = (
  statement: CompoundStatementNode,
  inputStates: ReadonlySet<number>,
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
  inputStates: ReadonlySet<number>,
): PositionExecutionResult => {
  if (statement.type === "compound_statement") {
    return analyzeCompoundStatement(statement, inputStates);
  }
  if (statement.type === "expression_statement") {
    const expressionWriteMask = getExpressionPositionWriteMask(statement.expression);
    if (
      expressionWriteMask === GLSL_NO_POSITION_COMPONENTS_BIT_MASK &&
      expressionContainsPositionWrite(statement.expression)
    ) {
      return {
        activeStates: inputStates,
        hasUnwrittenReturn: false,
        isSupported: false,
      };
    }
    return {
      activeStates:
        expressionWriteMask === GLSL_NO_POSITION_COMPONENTS_BIT_MASK
          ? inputStates
          : new Set([...inputStates].map((state) => state | expressionWriteMask)),
      hasUnwrittenReturn: false,
      isSupported: true,
    };
  }
  if (statement.type === "return_statement") {
    return {
      activeStates: new Set(),
      hasUnwrittenReturn: [...inputStates].some(
        (state) => state !== GLSL_ALL_POSITION_COMPONENTS_BIT_MASK,
      ),
      isSupported: true,
    };
  }
  if (statement.type === "if_statement") {
    if (expressionContainsPositionWrite(statement.condition)) {
      return {
        activeStates: inputStates,
        hasUnwrittenReturn: false,
        isSupported: false,
      };
    }
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
    const controlExpressions =
      statement.type === "for_statement"
        ? [
            Reflect.get(statement, "init"),
            Reflect.get(statement, "condition"),
            Reflect.get(statement, "operation"),
          ]
        : [statement.condition];
    if (
      controlExpressions.some((expression) => !expression) ||
      controlExpressions.some(expressionContainsPositionWrite)
    ) {
      return {
        activeStates: inputStates,
        hasUnwrittenReturn: false,
        isSupported: false,
      };
    }
    const bodyResult = analyzeStatement(statement.body, inputStates);
    return {
      activeStates: inputStates,
      hasUnwrittenReturn: bodyResult.hasUnwrittenReturn,
      isSupported: bodyResult.isSupported,
    };
  }
  if (
    statement.type === "declaration_statement" &&
    expressionContainsPositionWrite(statement.declaration)
  ) {
    return {
      activeStates: inputStates,
      hasUnwrittenReturn: false,
      isSupported: false,
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
    /^[ \t]*#[ \t]*define\b/m.test(maskGlslComments(source)) ||
    callsUserDefinedFunction(mainFunction, program)
  ) {
    return { mainFunction, writesPositionOnAllPaths: null };
  }
  const result = analyzeCompoundStatement(
    mainFunction.body,
    new Set([GLSL_NO_POSITION_COMPONENTS_BIT_MASK]),
  );
  if (!result.isSupported) {
    return { mainFunction, writesPositionOnAllPaths: null };
  }
  return {
    mainFunction,
    writesPositionOnAllPaths:
      !result.hasUnwrittenReturn &&
      [...result.activeStates].every((state) => state === GLSL_ALL_POSITION_COMPONENTS_BIT_MASK),
  };
};
