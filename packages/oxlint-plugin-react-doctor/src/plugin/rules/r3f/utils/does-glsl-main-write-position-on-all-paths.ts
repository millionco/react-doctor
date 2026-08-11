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

export interface GlslVectorPathAnalysis {
  readonly mainFunction: FunctionNode | null;
  readonly writesVectorOnAllPaths: boolean | null;
}

interface VectorExecutionResult {
  readonly activeStates: ReadonlySet<number>;
  readonly hasUnwrittenReturn: boolean;
  readonly isSupported: boolean;
}

const getVectorSwizzleWriteMask = (selection: string): number => {
  let writeMask = GLSL_NO_POSITION_COMPONENTS_BIT_MASK;
  for (const componentAlias of selection) {
    const componentBit = GLSL_POSITION_COMPONENT_BIT_BY_ALIAS.get(componentAlias);
    if (!componentBit) return GLSL_NO_POSITION_COMPONENTS_BIT_MASK;
    writeMask |= componentBit;
  }
  return writeMask;
};

const getExpressionVectorWriteMask = (expression: AstNode, targetIdentifier: string): number => {
  if (expression.type === "assignment" && expression.operator.literal === "=") {
    if (expression.left.type === "identifier" && expression.left.identifier === targetIdentifier) {
      return GLSL_ALL_POSITION_COMPONENTS_BIT_MASK;
    }
    if (
      expression.left.type === "postfix" &&
      expression.left.expression.type === "identifier" &&
      expression.left.expression.identifier === targetIdentifier &&
      expression.left.postfix.type === "field_selection"
    ) {
      const selection = Reflect.get(expression.left.postfix.selection, "identifier");
      return typeof selection === "string"
        ? getVectorSwizzleWriteMask(selection)
        : GLSL_NO_POSITION_COMPONENTS_BIT_MASK;
    }
  }
  if (expression.type === "binary" && expression.operator.literal === ",") {
    return (
      getExpressionVectorWriteMask(expression.left, targetIdentifier) |
      getExpressionVectorWriteMask(expression.right, targetIdentifier)
    );
  }
  if (expression.type === "group") {
    return getExpressionVectorWriteMask(expression.expression, targetIdentifier);
  }
  if (expression.type === "ternary") {
    return (
      getExpressionVectorWriteMask(expression.left, targetIdentifier) &
      getExpressionVectorWriteMask(expression.right, targetIdentifier)
    );
  }
  return GLSL_NO_POSITION_COMPONENTS_BIT_MASK;
};

const expressionContainsVectorWrite = (expression: AstNode, targetIdentifier: string): boolean => {
  let containsVectorWrite = false;
  visit(expression, {
    assignment: {
      enter: ({ node }) => {
        if (
          getExpressionVectorWriteMask(node, targetIdentifier) !==
          GLSL_NO_POSITION_COMPONENTS_BIT_MASK
        ) {
          containsVectorWrite = true;
        }
      },
    },
  });
  return containsVectorWrite;
};

const getBooleanConstant = (expression: AstNode): boolean | null => {
  if (expression.type !== "bool_constant") return null;
  return expression.token === "true";
};

const analyzeCompoundStatement = (
  statement: CompoundStatementNode,
  inputStates: ReadonlySet<number>,
  targetIdentifier: string,
): VectorExecutionResult => {
  let activeStates = inputStates;
  let hasUnwrittenReturn = false;
  for (const child of statement.statements) {
    if (activeStates.size === 0) break;
    const childResult = analyzeStatement(child, activeStates, targetIdentifier);
    if (!childResult.isSupported) return childResult;
    activeStates = childResult.activeStates;
    hasUnwrittenReturn ||= childResult.hasUnwrittenReturn;
  }
  return { activeStates, hasUnwrittenReturn, isSupported: true };
};

const analyzeStatement = (
  statement: AstNode,
  inputStates: ReadonlySet<number>,
  targetIdentifier: string,
): VectorExecutionResult => {
  if (statement.type === "compound_statement") {
    return analyzeCompoundStatement(statement, inputStates, targetIdentifier);
  }
  if (statement.type === "expression_statement") {
    const expressionWriteMask = getExpressionVectorWriteMask(
      statement.expression,
      targetIdentifier,
    );
    if (
      expressionWriteMask === GLSL_NO_POSITION_COMPONENTS_BIT_MASK &&
      expressionContainsVectorWrite(statement.expression, targetIdentifier)
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
  if (statement.type === "discard_statement") {
    return {
      activeStates: new Set(),
      hasUnwrittenReturn: false,
      isSupported: true,
    };
  }
  if (statement.type === "if_statement") {
    if (expressionContainsVectorWrite(statement.condition, targetIdentifier)) {
      return {
        activeStates: inputStates,
        hasUnwrittenReturn: false,
        isSupported: false,
      };
    }
    const constantCondition = getBooleanConstant(statement.condition);
    const consequent = analyzeStatement(statement.body, inputStates, targetIdentifier);
    if (!consequent.isSupported) return consequent;
    const alternateNodes = Reflect.get(statement, "else");
    const alternateStatement = Array.isArray(alternateNodes)
      ? alternateNodes[alternateNodes.length - 1]
      : undefined;
    const alternate = alternateStatement
      ? analyzeStatement(alternateStatement, inputStates, targetIdentifier)
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
      controlExpressions.some((expression) =>
        expressionContainsVectorWrite(expression, targetIdentifier),
      )
    ) {
      return {
        activeStates: inputStates,
        hasUnwrittenReturn: false,
        isSupported: false,
      };
    }
    const bodyResult = analyzeStatement(statement.body, inputStates, targetIdentifier);
    return {
      activeStates: inputStates,
      hasUnwrittenReturn: bodyResult.hasUnwrittenReturn,
      isSupported: bodyResult.isSupported,
    };
  }
  if (
    statement.type === "declaration_statement" &&
    expressionContainsVectorWrite(statement.declaration, targetIdentifier)
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

export const doesGlslMainWriteVectorOnAllPaths = (
  program: Program,
  source: string,
  targetIdentifier: string,
): GlslVectorPathAnalysis => {
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
    return { mainFunction, writesVectorOnAllPaths: null };
  }
  const result = analyzeCompoundStatement(
    mainFunction.body,
    new Set([GLSL_NO_POSITION_COMPONENTS_BIT_MASK]),
    targetIdentifier,
  );
  if (!result.isSupported) {
    return { mainFunction, writesVectorOnAllPaths: null };
  }
  return {
    mainFunction,
    writesVectorOnAllPaths:
      !result.hasUnwrittenReturn &&
      [...result.activeStates].every((state) => state === GLSL_ALL_POSITION_COMPONENTS_BIT_MASK),
  };
};

export const doesGlslMainWritePositionOnAllPaths = (
  program: Program,
  source: string,
): GlslPositionPathAnalysis => {
  const analysis = doesGlslMainWriteVectorOnAllPaths(program, source, "gl_Position");
  return {
    mainFunction: analysis.mainFunction,
    writesPositionOnAllPaths: analysis.writesVectorOnAllPaths,
  };
};
