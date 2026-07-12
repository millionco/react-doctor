import type { Reference } from "eslint-scope";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  collectRenderValueEvidence,
  type RenderValueEvidence,
} from "./collect-effect-state-write-facts.js";
import { getRef } from "./effect/ast.js";
import { isExternallyDrivenState } from "./effect/external-state.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import {
  getUseStateDecl,
  isGenuineReactHookDeclarator,
  isProp,
  isState,
  isStateSetter,
  isWholePropsObjectReference,
} from "./effect/react.js";

export interface RenderStateWriteFact {
  callExpression: EsTreeNode;
  stateDeclarator: EsTreeNode;
}

interface RenderSource {
  bindingIdentity: unknown;
}

interface StateRenderTracker {
  kind: "state";
  declarator: EsTreeNode;
}

interface RefRenderTracker {
  kind: "ref";
  reference: Reference;
}

interface RenderTrackerGuard {
  source: RenderSource;
  tracker: StateRenderTracker | RefRenderTracker;
  statements: ReadonlyArray<EsTreeNode>;
}

const findReferenceDeclarator = (reference: Reference): EsTreeNode | null => {
  for (const definition of reference.resolved?.defs ?? []) {
    const definitionNode = definition.node as unknown as EsTreeNode;
    if (isNodeOfType(definitionNode, "VariableDeclarator")) return definitionNode;
  }
  return null;
};

const resolveSimpleRenderSource = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  visitedBindings: ReadonlySet<unknown> = new Set(),
): RenderSource | null => {
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "Identifier")) return null;
  const reference = getRef(analysis, node);
  if (!reference?.resolved || visitedBindings.has(reference.resolved)) return null;
  if (isProp(analysis, reference)) {
    if (isWholePropsObjectReference(analysis, reference)) return null;
    return { bindingIdentity: reference.resolved };
  }
  if (isState(analysis, reference)) {
    const stateDeclarator = getUseStateDecl(analysis, reference);
    if (
      !stateDeclarator ||
      !isGenuineReactHookDeclarator(analysis, stateDeclarator, "useState") ||
      isExternallyDrivenState(analysis, reference)
    ) {
      return null;
    }
    return { bindingIdentity: reference.resolved };
  }
  if (
    reference.resolved.references.some(
      (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
    )
  ) {
    return null;
  }
  const declarator = findReferenceDeclarator(reference);
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return null;
  }
  const nextVisitedBindings = new Set(visitedBindings);
  nextVisitedBindings.add(reference.resolved);
  return resolveSimpleRenderSource(analysis, declarator.init as EsTreeNode, nextVisitedBindings);
};

const doesEvidenceMatchSource = (evidence: RenderValueEvidence, source: RenderSource): boolean =>
  evidence.isExclusivelyRenderKnown &&
  evidence.sourceReferences.size > 0 &&
  [...evidence.sourceReferences].every(
    (sourceReference) => sourceReference.resolved === source.bindingIdentity,
  );

const getDirectBranchStatements = (branch: EsTreeNode): ReadonlyArray<EsTreeNode> => {
  if (isNodeOfType(branch, "BlockStatement")) {
    return (branch.body ?? []) as ReadonlyArray<EsTreeNode>;
  }
  return [branch];
};

const getDirectCallExpression = (statement: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  return isNodeOfType(expression, "CallExpression") ? expression : null;
};

const getDirectAssignmentExpression = (statement: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  return isNodeOfType(expression, "AssignmentExpression") && expression.operator === "="
    ? expression
    : null;
};

const findDirectStateSetterReference = (
  analysis: ProgramAnalysis,
  callExpression: EsTreeNode,
): Reference | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return null;
  const reference = getRef(analysis, callee);
  return reference && isStateSetter(analysis, reference) ? reference : null;
};

const getStaticRefCurrentReference = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
): Reference | null => {
  const node = stripParenExpression(expression);
  if (
    !isNodeOfType(node, "MemberExpression") ||
    node.computed ||
    !isNodeOfType(node.object, "Identifier") ||
    !isNodeOfType(node.property, "Identifier") ||
    node.property.name !== "current"
  ) {
    return null;
  }
  const reference = getRef(analysis, node.object);
  if (!reference) return null;
  const declarator = findReferenceDeclarator(reference);
  return declarator && isGenuineReactHookDeclarator(analysis, declarator, "useRef")
    ? reference
    : null;
};

const getStateTracker = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
): StateRenderTracker | null => {
  const node = stripParenExpression(expression);
  if (!isNodeOfType(node, "Identifier")) return null;
  const reference = getRef(analysis, node);
  if (!reference || !isState(analysis, reference)) return null;
  const declarator = getUseStateDecl(analysis, reference);
  if (!declarator || !isGenuineReactHookDeclarator(analysis, declarator, "useState")) return null;
  return { kind: "state", declarator };
};

const getRefTracker = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
): RefRenderTracker | null => {
  const reference = getStaticRefCurrentReference(analysis, expression);
  return reference ? { kind: "ref", reference } : null;
};

const getTrackerInitializer = (
  tracker: StateRenderTracker | RefRenderTracker,
): EsTreeNode | null => {
  const declarator =
    tracker.kind === "state" ? tracker.declarator : findReferenceDeclarator(tracker.reference);
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.init, "CallExpression")
  ) {
    return null;
  }
  const initializer = declarator.init.arguments?.[0];
  return initializer ? (initializer as EsTreeNode) : null;
};

const isTrackerSynchronized = (analysis: ProgramAnalysis, guard: RenderTrackerGuard): boolean => {
  for (const statement of guard.statements) {
    if (guard.tracker.kind === "state") {
      const callExpression = getDirectCallExpression(statement);
      if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) continue;
      const setterReference = findDirectStateSetterReference(analysis, callExpression);
      if (
        !setterReference ||
        getUseStateDecl(analysis, setterReference) !== guard.tracker.declarator ||
        (callExpression.arguments ?? []).length !== 1
      ) {
        continue;
      }
      const writtenValue = callExpression.arguments?.[0];
      if (
        writtenValue &&
        resolveSimpleRenderSource(analysis, writtenValue as EsTreeNode)?.bindingIdentity ===
          guard.source.bindingIdentity
      ) {
        return true;
      }
      continue;
    }

    const assignmentExpression = getDirectAssignmentExpression(statement);
    if (!assignmentExpression || !isNodeOfType(assignmentExpression, "AssignmentExpression")) {
      continue;
    }
    const trackerReference = getStaticRefCurrentReference(
      analysis,
      assignmentExpression.left as EsTreeNode,
    );
    if (trackerReference?.resolved !== guard.tracker.reference.resolved) continue;
    if (
      resolveSimpleRenderSource(analysis, assignmentExpression.right as EsTreeNode)
        ?.bindingIdentity === guard.source.bindingIdentity
    ) {
      return true;
    }
  }
  return false;
};

const parseRenderTrackerGuard = (
  analysis: ProgramAnalysis,
  statement: EsTreeNode,
): RenderTrackerGuard | null => {
  if (
    !isNodeOfType(statement, "IfStatement") ||
    statement.alternate ||
    !isNodeOfType(statement.test, "BinaryExpression") ||
    statement.test.operator !== "!==" ||
    !isNodeOfType(statement.consequent, "BlockStatement")
  ) {
    return null;
  }
  const left = statement.test.left as EsTreeNode;
  const right = statement.test.right as EsTreeNode;
  const candidates: ReadonlyArray<{
    sourceExpression: EsTreeNode;
    trackerExpression: EsTreeNode;
  }> = [
    { sourceExpression: left, trackerExpression: right },
    { sourceExpression: right, trackerExpression: left },
  ];
  for (const candidate of candidates) {
    const source = resolveSimpleRenderSource(analysis, candidate.sourceExpression);
    if (!source) continue;
    const tracker =
      getStateTracker(analysis, candidate.trackerExpression) ??
      getRefTracker(analysis, candidate.trackerExpression);
    if (!tracker) continue;
    const trackerInitializer = getTrackerInitializer(tracker);
    if (
      !trackerInitializer ||
      resolveSimpleRenderSource(analysis, trackerInitializer)?.bindingIdentity !==
        source.bindingIdentity
    ) {
      continue;
    }
    const guard: RenderTrackerGuard = {
      source,
      tracker,
      statements: getDirectBranchStatements(statement.consequent as EsTreeNode),
    };
    return isTrackerSynchronized(analysis, guard) ? guard : null;
  }
  return null;
};

const isExclusiveDestinationSetterReference = (
  setterReference: Reference,
  callExpression: EsTreeNode,
): boolean => {
  if (!setterReference.resolved || !isNodeOfType(callExpression, "CallExpression")) return false;
  const references = setterReference.resolved.references.filter((reference) => !reference.init);
  if (references.length !== 1) return false;
  return references[0].identifier === callExpression.callee;
};

const getStateInitializer = (stateDeclarator: EsTreeNode): EsTreeNode | null => {
  if (
    !isNodeOfType(stateDeclarator, "VariableDeclarator") ||
    !isNodeOfType(stateDeclarator.init, "CallExpression")
  ) {
    return null;
  }
  const initializer = stateDeclarator.init.arguments?.[0];
  return initializer ? (initializer as EsTreeNode) : null;
};

export const collectRenderStateWriteFacts = (
  analysis: ProgramAnalysis,
  componentBody: EsTreeNode,
  currentFilename?: string,
): ReadonlyArray<RenderStateWriteFact> => {
  if (
    !isNodeOfType(componentBody, "BlockStatement") ||
    !componentBody.parent ||
    !isFunctionLike(componentBody.parent)
  ) {
    return [];
  }
  const componentFunction = componentBody.parent;
  const facts: RenderStateWriteFact[] = [];
  for (const statement of componentBody.body ?? []) {
    const guard = parseRenderTrackerGuard(analysis, statement as EsTreeNode);
    if (!guard) continue;
    for (const branchStatement of guard.statements) {
      const callExpression = getDirectCallExpression(branchStatement);
      if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) continue;
      const setterReference = findDirectStateSetterReference(analysis, callExpression);
      if (
        !setterReference ||
        (callExpression.arguments ?? []).length !== 1 ||
        !isExclusiveDestinationSetterReference(setterReference, callExpression)
      ) {
        continue;
      }
      const stateDeclarator = getUseStateDecl(analysis, setterReference);
      if (
        !stateDeclarator ||
        !isGenuineReactHookDeclarator(analysis, stateDeclarator, "useState") ||
        (guard.tracker.kind === "state" && stateDeclarator === guard.tracker.declarator)
      ) {
        continue;
      }
      const writtenValue = callExpression.arguments?.[0];
      const initializer = getStateInitializer(stateDeclarator);
      if (
        !writtenValue ||
        !initializer ||
        isFunctionLike(writtenValue as EsTreeNode) ||
        !doesEvidenceMatchSource(
          collectRenderValueEvidence(
            analysis,
            writtenValue as EsTreeNode,
            componentFunction,
            currentFilename,
          ),
          guard.source,
        ) ||
        !doesEvidenceMatchSource(
          collectRenderValueEvidence(analysis, initializer, componentFunction, currentFilename),
          guard.source,
        )
      ) {
        continue;
      }
      facts.push({ callExpression, stateDeclarator });
    }
  }
  return facts;
};
