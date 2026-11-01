import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";
import { hasOnlyErasedTypeNameBindings } from "./has-only-erased-type-name-bindings.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { collectBindingAliases } from "./collect-binding-aliases.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { findEnclosingClass } from "./find-enclosing-class.js";
import { findContainingSortedLiteral } from "./find-containing-sorted-literal.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getNodeEndIndex } from "./get-node-end-index.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { isFunctionLike } from "./is-function-like.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { parseSourceText } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const ERROR_PROVIDER_IDENTIFIER_NAMES = new Set([
  "Error",
  "eval",
  "Function",
  "Object",
  "Reflect",
  "globalThis",
  "window",
  "self",
  "global",
]);

interface RandomErrorProseFilterInput {
  filename: string;
  sourceText: string;
  scannableContent: string;
  contextPattern: RegExp;
}

interface RandomErrorProseAnalysis {
  callsByStart: Map<number, EsTreeNode>;
  stringLiterals: EsTreeNodeOfType<"Literal">[];
  providerCandidates: EsTreeNode[];
  catchClauses: EsTreeNode[];
  providerContradictions: Map<EsTreeNode | null, boolean>;
  scopes: ScopeAnalysis;
}

interface RandomOutputEvidence {
  hasUnsupportedDirectOutput: boolean;
  symbols: Set<SymbolDescriptor>;
  propertyNames: Set<string>;
  receiverSymbols: Set<SymbolDescriptor>;
}

interface RandomErrorProseFilter {
  (callIndex: number, lineStartIndex: number, lineEndIndex: number): boolean;
}

const hasMissingRuntimeReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    node.type !== "Identifier" ||
    scopes.referenceFor(node) ||
    scopes.symbolFor(node) ||
    isTypeScriptTypePosition(node)
  )
    return false;
  const parent = node.parent;
  if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed)
    return false;
  if (
    parent?.type === "Property" &&
    parent.key === node &&
    parent.value !== node &&
    !parent.computed
  )
    return false;
  if (
    (parent?.type === "MethodDefinition" || parent?.type === "PropertyDefinition") &&
    parent.key === node &&
    !parent.computed
  )
    return false;
  return true;
};

const findConsumingStatement = (node: EsTreeNode): EsTreeNode | null => {
  let current = node.parent;
  while (current && !isFunctionLike(current)) {
    if (
      current.type === "ExpressionStatement" ||
      current.type === "VariableDeclaration" ||
      current.type === "ReturnStatement" ||
      current.type === "ThrowStatement"
    )
      return current;
    current = current.parent;
  }
  return null;
};

const collectOutputEvidence = (call: EsTreeNode, scopes: ScopeAnalysis): RandomOutputEvidence => {
  const evidence: RandomOutputEvidence = {
    hasUnsupportedDirectOutput: false,
    symbols: new Set(),
    propertyNames: new Set(),
    receiverSymbols: new Set(),
  };
  const collectTargets = (node: EsTreeNode, isDirectOutput = false): void => {
    let current: EsTreeNode | null | undefined = node;
    while (current && !isFunctionLike(current)) {
      let target: EsTreeNode | null = null;
      if (current.type === "VariableDeclarator") target = current.id;
      if (current.type === "AssignmentExpression") target = current.left;
      if (target?.type === "Identifier") {
        const symbol = scopes.symbolFor(target);
        if (symbol) evidence.symbols.add(symbol);
      }
      if (target?.type === "MemberExpression") {
        const propertyName = getStaticPropertyKeyName(target, { allowComputedString: true });
        if (propertyName !== null) evidence.propertyNames.add(propertyName);
        const receiver = stripParenExpression(target.object);
        const symbol =
          receiver.type === "Identifier" ? scopes.referenceFor(receiver)?.resolvedSymbol : null;
        if (symbol) evidence.receiverSymbols.add(symbol);
        if (
          isDirectOutput &&
          (propertyName === null ||
            !(symbol || (receiver.type === "ThisExpression" && findEnclosingClass(target))))
        ) {
          evidence.hasUnsupportedDirectOutput = true;
        }
      }
      current = current.parent;
    }
  };
  collectTargets(call, true);
  let current = call.parent;
  while (current) {
    if (isFunctionLike(current)) {
      for (const symbol of getFunctionBindingSymbols(current, scopes)) {
        evidence.symbols.add(symbol);
        for (const reference of symbol.references) {
          const referenceRoot = findTransparentExpressionRoot(reference.identifier);
          const parent = referenceRoot.parent;
          if (parent?.type === "CallExpression" && parent.callee === referenceRoot) {
            collectTargets(parent);
          }
        }
      }
    }
    current = current.parent;
  }
  for (const symbols of [evidence.symbols, evidence.receiverSymbols]) {
    for (const symbol of [...symbols]) {
      const aliasSourceIdentifier = symbol.references[0]?.identifier ?? symbol.bindingIdentifier;
      for (const alias of collectBindingAliases(aliasSourceIdentifier, scopes)) {
        const aliasSymbol = scopes.symbolFor(alias);
        if (aliasSymbol) symbols.add(aliasSymbol);
      }
    }
  }
  return evidence;
};

const hasSelectedOutputCapture = (
  owner: EsTreeNode,
  selectedClass: EsTreeNode | null,
  evidence: RandomOutputEvidence,
  scopes: ScopeAnalysis,
): boolean => {
  const receiverSymbols = new Set(evidence.receiverSymbols);
  walkAst(owner, (node) => {
    let target: EsTreeNode | null = null;
    let value: EsTreeNode | null = null;
    if (node.type === "VariableDeclarator") {
      target = node.id;
      value = node.init;
    }
    if (node.type === "AssignmentExpression" && node.operator === "=") {
      target = node.left;
      value = node.right;
    }
    if (target?.type !== "Identifier" || !value) return;
    const initializer = stripParenExpression(value);
    let receiver: EsTreeNode = initializer;
    if (
      initializer.type === "CallExpression" &&
      initializer.callee.type === "MemberExpression" &&
      getStaticPropertyKeyName(initializer.callee, { allowComputedString: true }) === "assign"
    ) {
      const argument = initializer.arguments[0];
      if (!argument || argument.type === "SpreadElement") return;
      receiver = stripParenExpression(argument);
    }
    const receiverSymbol = receiver.type === "Identifier" ? scopes.symbolFor(receiver) : null;
    if (
      receiver.type !== "ThisExpression" &&
      !(receiverSymbol && receiverSymbols.has(receiverSymbol))
    )
      return;
    const targetSymbol = scopes.symbolFor(target);
    if (!targetSymbol) return;
    receiverSymbols.add(targetSymbol);
    for (const alias of collectBindingAliases(targetSymbol.bindingIdentifier, scopes)) {
      const aliasSymbol = scopes.symbolFor(alias);
      if (aliasSymbol) receiverSymbols.add(aliasSymbol);
    }
  });
  const selectedReferenceNames = new Set(
    [...evidence.symbols, ...receiverSymbols].map((symbol) => symbol.name),
  );
  let hasCapture = false;
  walkAst(owner, (node) => {
    if (node.type === "Identifier") {
      const symbol = scopes.referenceFor(node)?.resolvedSymbol;
      if (
        (symbol && evidence.symbols.has(symbol)) ||
        (selectedReferenceNames.has(node.name) && hasMissingRuntimeReference(node, scopes))
      )
        hasCapture = true;
    }
    if (node.type !== "MemberExpression") return;
    const propertyName = getStaticPropertyKeyName(node, { allowComputedString: true });
    const receiver = stripParenExpression(node.object);
    const symbol =
      receiver.type === "Identifier" ? scopes.referenceFor(receiver)?.resolvedSymbol : null;
    const isSelectedReceiver = Boolean(symbol && receiverSymbols.has(symbol));
    if (
      propertyName !== null &&
      evidence.propertyNames.has(propertyName) &&
      ((selectedClass !== null && findEnclosingClass(node) === selectedClass) || isSelectedReceiver)
    ) {
      hasCapture = true;
    }
    if (
      node.computed &&
      propertyName === null &&
      (receiver.type === "ThisExpression" || isSelectedReceiver)
    )
      hasCapture = true;
  });
  return hasCapture;
};

const hasCaughtMessageOutputUse = (
  catchClauses: EsTreeNode[],
  lexicalOwner: EsTreeNode | null,
  selectedClass: EsTreeNode | null,
  evidence: RandomOutputEvidence,
  scopes: ScopeAnalysis,
): boolean =>
  catchClauses.some((node) => {
    if (node.type !== "CatchClause" || (lexicalOwner && !isAstDescendant(node, lexicalOwner)))
      return false;
    if (!hasSelectedOutputCapture(node, selectedClass, evidence, scopes)) return false;
    if (node.param?.type !== "Identifier") return true;
    let consumesMessage = false;
    walkAst(node, (child) => {
      if (child.type !== "MemberExpression") return;
      const propertyName = getStaticPropertyKeyName(child, { allowComputedString: true });
      if (propertyName === "message" || (child.computed && propertyName === null))
        consumesMessage = true;
    });
    return consumesMessage;
  });

const isLocalProsePayload = (
  expression: EsTreeNode,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const pending: EsTreeNode[] = [expression];
  const visited = new Set<SymbolDescriptor>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    const node = stripParenExpression(current);
    if (node.type === "Literal" && !("regex" in node)) continue;
    if (node.type === "BinaryExpression" && node.operator === "+") {
      pending.push(node.left, node.right);
      continue;
    }
    if (node.type !== "Identifier") return false;
    const symbol = scopes.referenceFor(node)?.resolvedSymbol;
    if (!symbol || !isAstDescendant(symbol.bindingIdentifier, owner)) return false;
    if (visited.has(symbol)) continue;
    visited.add(symbol);
    for (const reference of symbol.references) {
      if (reference.flag === "read") continue;
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const assignment = referenceRoot.parent;
      if (
        assignment?.type !== "AssignmentExpression" ||
        assignment.operator !== "=" ||
        assignment.left !== referenceRoot
      )
        return false;
      pending.push(assignment.right);
    }
    if (symbol.kind === "parameter") continue;
    const initializer = symbol.initializer && stripParenExpression(symbol.initializer);
    if (!initializer) return false;
    if (initializer.type === "MemberExpression" && initializer.computed) {
      const receiver = stripParenExpression(initializer.object);
      const receiverSymbol =
        receiver.type === "Identifier" ? scopes.referenceFor(receiver)?.resolvedSymbol : null;
      if (receiverSymbol && isAstDescendant(receiverSymbol.bindingIdentifier, owner)) continue;
      return false;
    }
    pending.push(initializer);
  }
  return true;
};

const hasEnclosingSecurityName = (
  call: EsTreeNode,
  contextPattern: RegExp,
  sourceText: string,
): boolean => {
  let current: EsTreeNode | null | undefined = call;
  while (current) {
    let nameNode: EsTreeNode | null = null;
    if (current.type === "VariableDeclarator") nameNode = current.id;
    if (current.type === "AssignmentExpression") nameNode = current.left;
    if (
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression" ||
      current.type === "ClassDeclaration" ||
      current.type === "ClassExpression"
    ) {
      nameNode = current.id;
    }
    if (
      current.type === "Property" ||
      current.type === "MethodDefinition" ||
      current.type === "PropertyDefinition"
    )
      nameNode = current.key;
    if (
      nameNode &&
      contextPattern.test(sourceText.slice(getNodeStartIndex(nameNode), getNodeEndIndex(nameNode)))
    )
      return true;
    current = current.parent;
  }
  return false;
};

const hasErrorProviderContradiction = (
  nodes: EsTreeNode[],
  lexicalOwner: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean =>
  nodes.some((node) => {
    const isRelevantOwner =
      lexicalOwner === null ||
      findEnclosingFunction(node) === null ||
      isAstDescendant(node, lexicalOwner);
    if (node.type === "WithStatement") return isRelevantOwner;
    if (
      node.type === "TSDeclareFunction" &&
      node.id &&
      ERROR_PROVIDER_IDENTIFIER_NAMES.has(node.id.name)
    )
      return isRelevantOwner;
    if (node.type === "Identifier" && ERROR_PROVIDER_IDENTIFIER_NAMES.has(node.name)) {
      if (node.name === "Error") {
        return (
          isWithinAssignmentTarget(node) &&
          (scopes.isGlobalReference(node) || hasMissingRuntimeReference(node, scopes))
        );
      }
      return isRelevantOwner && hasMissingRuntimeReference(node, scopes);
    }
    if (
      isRelevantOwner &&
      node.type === "MemberExpression" &&
      getStaticPropertyKeyName(node, { allowComputedString: true }) === "Error" &&
      isWithinAssignmentTarget(node)
    )
      return true;
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const callee = stripParenExpression(node.callee);
      if (
        isRelevantOwner &&
        (isProvenGlobalNamespaceReference(callee, "eval", scopes) ||
          isProvenGlobalNamespaceReference(callee, "Function", scopes))
      )
        return true;
      if (node.type !== "CallExpression" || callee.type !== "MemberExpression") return false;
      const methodName = getStaticPropertyKeyName(callee, { allowComputedString: true });
      const isObjectMutation =
        isProvenGlobalNamespaceReference(callee.object, "Object", scopes) &&
        (methodName === "defineProperty" ||
          methodName === "defineProperties" ||
          methodName === "assign");
      const isReflectMutation =
        isProvenGlobalNamespaceReference(callee.object, "Reflect", scopes) && methodName === "set";
      if (!isObjectMutation && !isReflectMutation) return false;
      const receiver = node.arguments[0];
      if (!receiver || receiver.type === "SpreadElement") return false;
      if (isProvenGlobalNamespaceReference(receiver, "Error", scopes)) return true;
      const isGlobalObject = isProvenGlobalObjectReference(receiver, scopes);
      if (!isGlobalObject && !isRelevantOwner) return false;
      if (methodName === "defineProperty" || methodName === "set") {
        const key = node.arguments[1];
        return key?.type === "Literal" ? key.value === "Error" : isGlobalObject;
      }
      return node.arguments.slice(1).some((argument) => {
        if (argument.type !== "ObjectExpression") return isGlobalObject;
        return argument.properties.some((property) => {
          if (property.type === "SpreadElement") return isGlobalObject;
          const key = getStaticPropertyKeyName(property, { allowComputedString: true });
          return key === "Error" || (key === null && isGlobalObject);
        });
      });
    }
    let target: EsTreeNode | null = null;
    if (node.type === "AssignmentExpression") target = node.left;
    if (node.type === "UpdateExpression") target = node.argument;
    if (node.type === "UnaryExpression" && node.operator === "delete") target = node.argument;
    while (target) {
      if (
        isRelevantOwner &&
        target.type === "MemberExpression" &&
        getStaticPropertyKeyName(target, { allowComputedString: true }) === "Error"
      )
        return true;
      if (isProvenGlobalNamespaceReference(target, "Error", scopes)) return true;
      const expression = stripParenExpression(target);
      target = expression.type === "MemberExpression" ? expression.object : null;
    }
    return false;
  });

export const createRandomErrorProseFilter = ({
  filename,
  sourceText,
  scannableContent,
  contextPattern,
}: RandomErrorProseFilterInput): RandomErrorProseFilter => {
  let analysis: RandomErrorProseAnalysis | null | undefined;
  const firstNonAsciiIndex = sourceText.search(/\P{ASCII}/u);
  return (callIndex, lineStartIndex, lineEndIndex) => {
    try {
      if (firstNonAsciiIndex >= 0 && firstNonAsciiIndex < lineEndIndex) return false;
      if (analysis === undefined) {
        const program = parseSourceText({ filename, sourceText });
        analysis = null;
        if (program) {
          const callsByStart = new Map<number, EsTreeNode>();
          const stringLiterals: EsTreeNodeOfType<"Literal">[] = [];
          const providerCandidates: EsTreeNode[] = [];
          const catchClauses: EsTreeNode[] = [];
          walkAst(program, (node) => {
            if (node.type === "CallExpression") callsByStart.set(getNodeStartIndex(node), node);
            if (node.type === "Literal" && typeof node.value === "string")
              stringLiterals.push(node);
            if (node.type === "CatchClause") catchClauses.push(node);
            if (
              node.type === "CallExpression" ||
              node.type === "NewExpression" ||
              node.type === "AssignmentExpression" ||
              node.type === "UpdateExpression" ||
              node.type === "UnaryExpression" ||
              node.type === "WithStatement" ||
              (node.type === "TSDeclareFunction" &&
                node.id &&
                ERROR_PROVIDER_IDENTIFIER_NAMES.has(node.id.name)) ||
              (node.type === "Identifier" && ERROR_PROVIDER_IDENTIFIER_NAMES.has(node.name)) ||
              (node.type === "MemberExpression" &&
                getStaticPropertyKeyName(node, { allowComputedString: true }) === "Error")
            )
              providerCandidates.push(node);
          });
          stringLiterals.sort((left, right) => getNodeStartIndex(left) - getNodeStartIndex(right));
          const scopeAnalysis = analyzeScopes(program);
          analysis = {
            callsByStart,
            stringLiterals,
            providerCandidates,
            catchClauses,
            providerContradictions: new Map(),
            scopes: {
              ...scopeAnalysis,
              isGlobalReference: (identifier) => {
                if (
                  identifier.type === "Identifier" &&
                  ERROR_PROVIDER_IDENTIFIER_NAMES.has(identifier.name) &&
                  hasVisibleAmbientFunctionDeclaration(
                    scopeAnalysis.scopeFor(identifier),
                    identifier.name,
                  )
                )
                  return false;
                if (scopeAnalysis.isGlobalReference(identifier)) return true;
                if (
                  identifier.type !== "Identifier" ||
                  !ERROR_PROVIDER_IDENTIFIER_NAMES.has(identifier.name)
                )
                  return false;
                const symbol = scopeAnalysis.symbolFor(identifier);
                return Boolean(symbol && hasOnlyErasedTypeNameBindings(symbol));
              },
            },
          };
        }
      }
      if (!analysis) return false;
      const {
        callsByStart,
        stringLiterals,
        providerCandidates,
        catchClauses,
        providerContradictions,
        scopes,
      } = analysis;
      const call = callsByStart.get(callIndex);
      if (
        call?.type !== "CallExpression" ||
        call.optional ||
        call.arguments.length !== 0 ||
        call.callee.type !== "MemberExpression" ||
        call.callee.computed ||
        call.callee.optional ||
        call.callee.object.type !== "Identifier" ||
        call.callee.object.name !== "Math" ||
        call.callee.property.type !== "Identifier" ||
        call.callee.property.name !== "random" ||
        !/^Math\.random\s*\(\s*\)$/.test(sourceText.slice(callIndex, getNodeEndIndex(call)))
      )
        return false;
      const randomOwner = findEnclosingFunction(call);
      const statement = findConsumingStatement(call);
      if (!randomOwner || !statement || hasEnclosingSecurityName(call, contextPattern, sourceText))
        return false;
      const evidence = collectOutputEvidence(call, scopes);
      if (evidence.hasUnsupportedDirectOutput) return false;
      const lexicalOwner = findEnclosingFunction(findEnclosingClass(call) ?? randomOwner);
      if (!providerContradictions.has(lexicalOwner)) {
        providerContradictions.set(
          lexicalOwner,
          hasErrorProviderContradiction(providerCandidates, lexicalOwner, scopes),
        );
      }
      if (
        providerContradictions.get(lexicalOwner) ||
        hasCaughtMessageOutputUse(
          catchClauses,
          lexicalOwner,
          findEnclosingClass(call),
          evidence,
          scopes,
        )
      )
        return false;
      const securityMatches = scannableContent
        .slice(lineStartIndex, lineEndIndex)
        .matchAll(new RegExp(contextPattern.source, "gi"));
      let foundProse = false;
      for (const match of securityMatches) {
        const matchStart = lineStartIndex + match.index;
        const matchEnd = matchStart + match[0].length;
        const literal = findContainingSortedLiteral(stringLiterals, matchStart, matchEnd);
        if (!literal || isAstDescendant(literal, statement)) return false;
        const rawLiteral = sourceText.slice(getNodeStartIndex(literal), getNodeEndIndex(literal));
        if (rawLiteral[0] !== '"' && rawLiteral[0] !== "'") return false;
        let payload = findTransparentExpressionRoot(literal);
        while (payload.parent?.type === "BinaryExpression" && payload.parent.operator === "+") {
          payload = findTransparentExpressionRoot(payload.parent);
        }
        const construction = payload.parent;
        if (
          construction?.type !== "NewExpression" ||
          construction.arguments.length !== 1 ||
          construction.arguments[0] !== payload ||
          construction.callee.type !== "Identifier" ||
          construction.callee.name !== "Error" ||
          !scopes.isGlobalReference(construction.callee)
        )
          return false;
        const constructionRoot = findTransparentExpressionRoot(construction);
        if (
          constructionRoot.parent?.type !== "ThrowStatement" ||
          constructionRoot.parent.argument !== constructionRoot
        )
          return false;
        const proseOwner = findEnclosingFunction(construction);
        if (
          !proseOwner ||
          isAstDescendant(proseOwner, randomOwner) ||
          isAstDescendant(randomOwner, proseOwner) ||
          !isLocalProsePayload(payload, proseOwner, scopes) ||
          hasSelectedOutputCapture(proseOwner, findEnclosingClass(call), evidence, scopes)
        )
          return false;
        foundProse = true;
      }
      return foundProse;
    } catch {
      analysis = null;
      return false;
    }
  };
};
