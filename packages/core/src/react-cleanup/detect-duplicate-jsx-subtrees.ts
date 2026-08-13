import crypto from "node:crypto";
import ts from "typescript";
import {
  JSX_DUPLICATION_DEFAULT_MAX_FAMILIES,
  JSX_DUPLICATION_DEFAULT_MAX_JSX_NODES,
  JSX_DUPLICATION_DEFAULT_MAX_SOURCE_FILES,
  JSX_DUPLICATION_DEFAULT_MAX_SOURCE_LENGTH_CHARS,
  JSX_DUPLICATION_DEFAULT_MINIMUM_DEPTH,
  JSX_DUPLICATION_DEFAULT_MINIMUM_DISTINCT_FILES,
  JSX_DUPLICATION_DEFAULT_MINIMUM_NODE_COUNT,
  JSX_DUPLICATION_DEFAULT_MINIMUM_OCCURRENCES,
  JSX_DUPLICATION_FAMILY_PROCESSING_MULTIPLIER,
  JSX_DUPLICATION_MAX_COMPOSITION_PATH_DEPTH,
} from "../constants.js";
import { getTypescriptScriptKind } from "../utils/get-typescript-script-kind.js";
import { unwrapTypescriptExpression } from "../utils/unwrap-typescript-expression.js";
import { yieldToEventLoop } from "../utils/yield-to-event-loop.js";
import { isNonReactJsxSource } from "./utils/is-non-react-jsx-source.js";

export interface JsxDuplicationSource {
  path: string;
  sourceText: string;
}

export interface JsxDuplicationSourceReader {
  readonly paths: ReadonlyArray<string>;
  readonly read: (path: string, maximumLengthChars: number) => Promise<string | null>;
}

export interface JsxDuplicationBudget {
  maxSourceFiles?: number;
  maxSourceLengthChars?: number;
  maxJsxNodes?: number;
  maxFamilies?: number;
}

export interface DetectDuplicateJsxSubtreesOptions {
  minimumNodeCount?: number;
  minimumDepth?: number;
  minimumOccurrences?: number;
  minimumDistinctFiles?: number;
  budget?: JsxDuplicationBudget;
  signal?: AbortSignal;
}

export interface DuplicateJsxSubtreeOccurrence {
  path: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  rootName: string;
  parentRootName: string | null;
  compositionPath: string[];
  compositionRootStartOffset: number | null;
}

export interface DuplicateJsxSubtreeFamily {
  fingerprint: string;
  nodeCount: number;
  depth: number;
  occurrenceCount: number;
  distinctFileCount: number;
  estimatedRemovableNodeCount: number;
  estimatedRemovableLineCount: number;
  primaryOccurrence: DuplicateJsxSubtreeOccurrence;
  relatedOccurrences: DuplicateJsxSubtreeOccurrence[];
}

export interface JsxDuplicationIncompleteReason {
  kind: "source-file-limit" | "source-length-limit" | "jsx-node-limit" | "aborted";
  limit?: number;
  observed: number;
  path?: string;
}

export interface DuplicateJsxSubtreesResult {
  families: DuplicateJsxSubtreeFamily[];
  scannedSourceFileCount: number;
  scannedJsxNodeCount: number;
  incomplete: boolean;
  incompleteReasons: JsxDuplicationIncompleteReason[];
}

interface ResolvedJsxDuplicationOptions {
  minimumNodeCount: number;
  minimumDepth: number;
  minimumOccurrences: number;
  minimumDistinctFiles: number;
  maxSourceFiles: number;
  maxSourceLengthChars: number;
  maxJsxNodes: number;
  maxFamilies: number;
}

interface JsxSubtreeMetadata {
  fingerprint: string;
  nodeCount: number;
  depth: number;
}

interface JsxSubtreeCandidate {
  metadata: JsxSubtreeMetadata;
  occurrence: DuplicateJsxSubtreeOccurrence;
}

interface JsxSubtreeBucket {
  metadata: JsxSubtreeMetadata;
  occurrences: DuplicateJsxSubtreeOccurrence[];
}

interface CollectedJsxSubtreeCandidates {
  candidates: JsxSubtreeCandidate[];
  aborted: boolean;
  limitExceeded: boolean;
}

interface ScannedJsxDuplicationSource {
  candidates: JsxSubtreeCandidate[];
  incompleteReason: JsxDuplicationIncompleteReason | null;
  didAbort: boolean;
  didScan: boolean;
}

interface ScanJsxDuplicationSourceInput {
  source: JsxDuplicationSource;
  options: ResolvedJsxDuplicationOptions;
  signal: AbortSignal | undefined;
  scannedSourceFileCount: number;
  scannedJsxNodeCount: number;
}

interface BuildDuplicateJsxResultInput {
  candidates: JsxSubtreeCandidate[];
  options: ResolvedJsxDuplicationOptions;
  incompleteReasons: JsxDuplicationIncompleteReason[];
  scannedSourceFileCount: number;
  scannedJsxNodeCount: number;
}

interface BuiltDuplicateJsxFamilies {
  families: DuplicateJsxSubtreeFamily[];
}

interface FunctionIdentity {
  name: string;
  startOffset: number;
}

type JsxSubtreeNode = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

const isJsxSubtreeNode = (node: ts.Node): node is JsxSubtreeNode =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);

const resolveOptions = (
  options: DetectDuplicateJsxSubtreesOptions,
): ResolvedJsxDuplicationOptions => ({
  minimumNodeCount: options.minimumNodeCount ?? JSX_DUPLICATION_DEFAULT_MINIMUM_NODE_COUNT,
  minimumDepth: options.minimumDepth ?? JSX_DUPLICATION_DEFAULT_MINIMUM_DEPTH,
  minimumOccurrences: options.minimumOccurrences ?? JSX_DUPLICATION_DEFAULT_MINIMUM_OCCURRENCES,
  minimumDistinctFiles:
    options.minimumDistinctFiles ?? JSX_DUPLICATION_DEFAULT_MINIMUM_DISTINCT_FILES,
  maxSourceFiles: options.budget?.maxSourceFiles ?? JSX_DUPLICATION_DEFAULT_MAX_SOURCE_FILES,
  maxSourceLengthChars:
    options.budget?.maxSourceLengthChars ?? JSX_DUPLICATION_DEFAULT_MAX_SOURCE_LENGTH_CHARS,
  maxJsxNodes: options.budget?.maxJsxNodes ?? JSX_DUPLICATION_DEFAULT_MAX_JSX_NODES,
  maxFamilies: options.budget?.maxFamilies ?? JSX_DUPLICATION_DEFAULT_MAX_FAMILIES,
});

const hashParts = (parts: string[]): string => {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(String(part.length));
    hash.update(":");
    hash.update(part);
  }
  return hash.digest("hex");
};

const collectDirectJsxDescendants = (node: ts.Node): JsxSubtreeNode[] => {
  const descendants: JsxSubtreeNode[] = [];
  const pendingNodes: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    pendingNodes.push(child);
  });
  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop();
    if (currentNode === undefined) continue;
    if (isJsxSubtreeNode(currentNode)) {
      descendants.push(currentNode);
      continue;
    }
    ts.forEachChild(currentNode, (child) => {
      pendingNodes.push(child);
    });
  }
  return descendants;
};

const buildStructuralHash = (
  node: ts.Node,
  metadataByNode: Map<JsxSubtreeNode, JsxSubtreeMetadata>,
): string => {
  if (isJsxSubtreeNode(node)) {
    return buildJsxSubtreeMetadata(node, metadataByNode).fingerprint;
  }
  if (ts.isJsxText(node)) {
    return node.getText().trim().length === 0 ? "jsx-whitespace" : "jsx-text";
  }
  if (ts.isPropertyAccessExpression(node)) {
    return hashParts([
      "property-access",
      node.questionDotToken === undefined ? "required" : "optional",
      buildStructuralHash(node.expression, metadataByNode),
      node.name.text,
    ]);
  }
  if (ts.isElementAccessExpression(node)) {
    const argumentHash =
      ts.isStringLiteral(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression)
        ? `${ts.SyntaxKind[node.argumentExpression.kind]}:${node.argumentExpression.text}`
        : buildStructuralHash(node.argumentExpression, metadataByNode);
    return hashParts([
      "element-access",
      node.questionDotToken === undefined ? "required" : "optional",
      buildStructuralHash(node.expression, metadataByNode),
      argumentHash,
    ]);
  }
  if (ts.isBinaryExpression(node)) {
    return hashParts([
      "binary-expression",
      ts.SyntaxKind[node.operatorToken.kind],
      buildStructuralHash(node.left, metadataByNode),
      buildStructuralHash(node.right, metadataByNode),
    ]);
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    return hashParts([
      ts.SyntaxKind[node.kind],
      ts.SyntaxKind[node.operator],
      buildStructuralHash(node.operand, metadataByNode),
    ]);
  }
  if (ts.isIdentifier(node)) return "identifier";
  if (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isRegularExpressionLiteral(node)
  ) {
    return ts.SyntaxKind[node.kind];
  }
  if (ts.isJsxAttribute(node)) {
    let initializerHash = "present";
    if (node.initializer !== undefined) {
      if (ts.isStringLiteral(node.initializer)) {
        initializerHash = `string:${node.initializer.text}`;
      } else if (
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression !== undefined &&
        (ts.isStringLiteral(node.initializer.expression) ||
          ts.isNumericLiteral(node.initializer.expression) ||
          node.initializer.expression.kind === ts.SyntaxKind.TrueKeyword ||
          node.initializer.expression.kind === ts.SyntaxKind.FalseKeyword ||
          node.initializer.expression.kind === ts.SyntaxKind.NullKeyword)
      ) {
        initializerHash = `static:${node.initializer.expression.getText()}`;
      } else {
        initializerHash = buildStructuralHash(node.initializer, metadataByNode);
      }
    }
    return hashParts(["attribute", node.name.getText(), initializerHash]);
  }
  if (ts.isPropertyAssignment(node)) {
    return hashParts([
      "property-assignment",
      node.name.getText(),
      buildStructuralHash(node.initializer, metadataByNode),
    ]);
  }
  if (ts.isShorthandPropertyAssignment(node)) {
    return hashParts(["shorthand-property", node.name.text]);
  }
  if (ts.isJsxSpreadAttribute(node)) {
    return hashParts(["spread", buildStructuralHash(node.expression, metadataByNode)]);
  }

  const childHashes: string[] = [];
  ts.forEachChild(node, (child) => {
    childHashes.push(buildStructuralHash(child, metadataByNode));
  });
  return hashParts([ts.SyntaxKind[node.kind], ...childHashes]);
};

const buildJsxSubtreeMetadata = (
  node: JsxSubtreeNode,
  metadataByNode: Map<JsxSubtreeNode, JsxSubtreeMetadata>,
): JsxSubtreeMetadata => {
  const existingMetadata = metadataByNode.get(node);
  if (existingMetadata) return existingMetadata;

  const directDescendants = collectDirectJsxDescendants(node);
  const descendantMetadata = directDescendants.map((descendant) =>
    buildJsxSubtreeMetadata(descendant, metadataByNode),
  );
  const nodeParts: string[] = [ts.SyntaxKind[node.kind]];
  if (ts.isJsxElement(node)) {
    nodeParts.push(node.openingElement.tagName.getText());
  } else if (ts.isJsxSelfClosingElement(node)) {
    nodeParts.push(node.tagName.getText());
  } else {
    nodeParts.push("fragment");
  }
  ts.forEachChild(node, (child) => {
    if (ts.isJsxClosingElement(child) || ts.isJsxClosingFragment(child)) return;
    if (ts.isJsxText(child) && child.getText().trim().length === 0) return;
    if (ts.isJsxExpression(child) && child.expression === undefined) return;
    nodeParts.push(buildStructuralHash(child, metadataByNode));
  });

  const metadata: JsxSubtreeMetadata = {
    fingerprint: `jsx:${hashParts(nodeParts)}`,
    nodeCount:
      1 + descendantMetadata.reduce((total, descendant) => total + descendant.nodeCount, 0),
    depth:
      1 +
      descendantMetadata.reduce((maximum, descendant) => Math.max(maximum, descendant.depth), 0),
  };
  metadataByNode.set(node, metadata);
  return metadata;
};

const getRootName = (node: JsxSubtreeNode): string => {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return "Fragment";
};

const getFunctionIdentity = (
  node: ts.Node,
  identityByNode: Map<ts.Node, FunctionIdentity | null>,
): FunctionIdentity | null => {
  if (identityByNode.has(node)) return identityByNode.get(node) ?? null;
  const traversedNodes: ts.Node[] = [node];
  let currentNode: ts.Node | undefined = node.parent;
  let functionIdentity: FunctionIdentity | null = null;
  while (currentNode !== undefined) {
    if (identityByNode.has(currentNode)) {
      functionIdentity = identityByNode.get(currentNode) ?? null;
      break;
    }
    traversedNodes.push(currentNode);
    if (ts.isFunctionDeclaration(currentNode)) {
      if (currentNode.name !== undefined) {
        functionIdentity = { name: currentNode.name.text, startOffset: currentNode.getStart() };
        break;
      }
      if (
        ts
          .getModifiers(currentNode)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      ) {
        functionIdentity = { name: "default export", startOffset: currentNode.getStart() };
        break;
      }
    }
    if (ts.isMethodDeclaration(currentNode)) {
      const classDeclaration = currentNode.parent;
      if (ts.isClassDeclaration(classDeclaration) && classDeclaration.name !== undefined) {
        functionIdentity = {
          name: classDeclaration.name.text,
          startOffset: classDeclaration.getStart(),
        };
        break;
      }
      functionIdentity = { name: currentNode.name.getText(), startOffset: currentNode.getStart() };
      break;
    }
    if (ts.isFunctionExpression(currentNode) && currentNode.name !== undefined) {
      functionIdentity = { name: currentNode.name.text, startOffset: currentNode.getStart() };
      break;
    }
    if (ts.isArrowFunction(currentNode) || ts.isFunctionExpression(currentNode)) {
      let assignmentNode: ts.Node | undefined = currentNode.parent;
      while (
        assignmentNode !== undefined &&
        (ts.isCallExpression(assignmentNode) ||
          ts.isExpressionWithTypeArguments(assignmentNode) ||
          (ts.isExpression(assignmentNode) &&
            unwrapTypescriptExpression(assignmentNode) !== assignmentNode))
      ) {
        assignmentNode = assignmentNode.parent;
      }
      if (assignmentNode !== undefined && ts.isVariableDeclaration(assignmentNode)) {
        functionIdentity = {
          name: assignmentNode.name.getText(),
          startOffset: assignmentNode.getStart(),
        };
        break;
      }
      if (assignmentNode !== undefined && ts.isPropertyAssignment(assignmentNode)) {
        functionIdentity = {
          name: assignmentNode.name.getText(),
          startOffset: assignmentNode.getStart(),
        };
        break;
      }
      if (
        assignmentNode !== undefined &&
        ts.isExportAssignment(assignmentNode) &&
        !assignmentNode.isExportEquals
      ) {
        functionIdentity = { name: "default export", startOffset: assignmentNode.getStart() };
        break;
      }
    }
    currentNode = currentNode.parent;
  }
  for (const traversedNode of traversedNodes) identityByNode.set(traversedNode, functionIdentity);
  return functionIdentity;
};

const buildOccurrence = (
  path: string,
  sourceFile: ts.SourceFile,
  node: JsxSubtreeNode,
  ancestorRootNames: ReadonlyArray<string>,
  functionIdentityByNode: Map<ts.Node, FunctionIdentity | null>,
): DuplicateJsxSubtreeOccurrence => {
  const startOffset = node.getStart(sourceFile);
  const endOffset = node.getEnd();
  const start = sourceFile.getLineAndCharacterOfPosition(startOffset);
  const end = sourceFile.getLineAndCharacterOfPosition(endOffset);
  const functionIdentity = getFunctionIdentity(node, functionIdentityByNode);
  const compositionPath = [...ancestorRootNames, getRootName(node)];
  if (functionIdentity !== null) compositionPath.unshift(functionIdentity.name);
  return {
    path,
    startOffset,
    endOffset,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
    rootName: getRootName(node),
    parentRootName: ancestorRootNames.at(-1) ?? null,
    compositionPath,
    compositionRootStartOffset: functionIdentity?.startOffset ?? null,
  };
};

const collectCandidates = (
  source: JsxDuplicationSource,
  sourceFile: ts.SourceFile,
  signal: AbortSignal | undefined,
  maximumCandidateCount: number,
): CollectedJsxSubtreeCandidates => {
  const jsxNodes: JsxSubtreeNode[] = [];
  const pendingNodes: ts.Node[] = [sourceFile];
  let limitExceeded = false;
  while (pendingNodes.length > 0 && !limitExceeded && !signal?.aborted) {
    const currentNode = pendingNodes.pop();
    if (currentNode === undefined) continue;
    if (isJsxSubtreeNode(currentNode)) {
      if (jsxNodes.length >= maximumCandidateCount) {
        limitExceeded = true;
        continue;
      }
      jsxNodes.push(currentNode);
    }
    const childNodes: ts.Node[] = [];
    ts.forEachChild(currentNode, (child) => {
      childNodes.push(child);
    });
    for (let childIndex = childNodes.length - 1; childIndex >= 0; childIndex -= 1) {
      pendingNodes.push(childNodes[childIndex]);
    }
  }
  if (limitExceeded || signal?.aborted) {
    return { candidates: [], aborted: signal?.aborted ?? false, limitExceeded };
  }

  const metadataByNode = new Map<JsxSubtreeNode, JsxSubtreeMetadata>();
  const functionIdentityByNode = new Map<ts.Node, FunctionIdentity | null>();
  for (let nodeIndex = jsxNodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    if (signal?.aborted) {
      return { candidates: [], aborted: true, limitExceeded: false };
    }
    buildJsxSubtreeMetadata(jsxNodes[nodeIndex], metadataByNode);
  }
  const candidates = jsxNodes.map((node) => {
    const ancestorRootNames: string[] = [];
    let ancestorNode: ts.Node | undefined = node.parent;
    while (
      ancestorNode !== undefined &&
      ancestorRootNames.length < JSX_DUPLICATION_MAX_COMPOSITION_PATH_DEPTH - 1
    ) {
      if (isJsxSubtreeNode(ancestorNode)) ancestorRootNames.unshift(getRootName(ancestorNode));
      ancestorNode = ancestorNode.parent;
    }
    return {
      metadata: buildJsxSubtreeMetadata(node, metadataByNode),
      occurrence: buildOccurrence(
        source.path,
        sourceFile,
        node,
        ancestorRootNames,
        functionIdentityByNode,
      ),
    };
  });
  return { candidates, aborted: false, limitExceeded: false };
};

const scanSource = (input: ScanJsxDuplicationSourceInput): ScannedJsxDuplicationSource => {
  if (input.source.sourceText.length > input.options.maxSourceLengthChars) {
    return {
      candidates: [],
      incompleteReason: {
        kind: "source-length-limit",
        limit: input.options.maxSourceLengthChars,
        observed: input.source.sourceText.length,
        path: input.source.path,
      },
      didAbort: false,
      didScan: false,
    };
  }
  const sourceFile = ts.createSourceFile(
    input.source.path,
    input.source.sourceText,
    ts.ScriptTarget.Latest,
    true,
    getTypescriptScriptKind(input.source.path),
  );
  if (isNonReactJsxSource(sourceFile)) {
    return {
      candidates: [],
      incompleteReason: null,
      didAbort: false,
      didScan: true,
    };
  }
  const collectedCandidates = collectCandidates(
    input.source,
    sourceFile,
    input.signal,
    input.options.maxJsxNodes - input.scannedJsxNodeCount,
  );
  if (collectedCandidates.aborted) {
    return {
      candidates: [],
      incompleteReason: { kind: "aborted", observed: input.scannedSourceFileCount },
      didAbort: true,
      didScan: false,
    };
  }
  if (collectedCandidates.limitExceeded) {
    return {
      candidates: [],
      incompleteReason: {
        kind: "jsx-node-limit",
        limit: input.options.maxJsxNodes,
        observed: input.options.maxJsxNodes + 1,
        path: input.source.path,
      },
      didAbort: false,
      didScan: false,
    };
  }
  return {
    candidates: collectedCandidates.candidates,
    incompleteReason: null,
    didAbort: false,
    didScan: true,
  };
};

const occurrenceIsContained = (
  inner: DuplicateJsxSubtreeOccurrence,
  outer: DuplicateJsxSubtreeOccurrence,
): boolean =>
  inner.path === outer.path &&
  inner.startOffset >= outer.startOffset &&
  inner.endOffset <= outer.endOffset;

const familyIsNestedWithin = (
  candidate: DuplicateJsxSubtreeFamily,
  outer: DuplicateJsxSubtreeFamily,
): boolean => {
  const outerOccurrences = [outer.primaryOccurrence, ...outer.relatedOccurrences];
  return [candidate.primaryOccurrence, ...candidate.relatedOccurrences].every((occurrence) =>
    outerOccurrences.some((outerOccurrence) => occurrenceIsContained(occurrence, outerOccurrence)),
  );
};

const suppressNestedFamilies = (
  families: DuplicateJsxSubtreeFamily[],
): DuplicateJsxSubtreeFamily[] => {
  const familiesBySize = [...families].sort(
    (left, right) => right.nodeCount - left.nodeCount || right.depth - left.depth,
  );
  const maximalFamilies: DuplicateJsxSubtreeFamily[] = [];
  for (const family of familiesBySize) {
    if (maximalFamilies.some((outer) => familyIsNestedWithin(family, outer))) continue;
    maximalFamilies.push(family);
  }
  return maximalFamilies;
};

const compareOccurrences = (
  left: DuplicateJsxSubtreeOccurrence,
  right: DuplicateJsxSubtreeOccurrence,
): number =>
  left.path.localeCompare(right.path) ||
  left.startOffset - right.startOffset ||
  left.endOffset - right.endOffset;

const compareFamilies = (
  left: DuplicateJsxSubtreeFamily,
  right: DuplicateJsxSubtreeFamily,
): number =>
  right.estimatedRemovableNodeCount - left.estimatedRemovableNodeCount ||
  right.estimatedRemovableLineCount - left.estimatedRemovableLineCount ||
  right.occurrenceCount - left.occurrenceCount ||
  right.distinctFileCount - left.distinctFileCount ||
  right.nodeCount - left.nodeCount ||
  compareOccurrences(left.primaryOccurrence, right.primaryOccurrence) ||
  left.fingerprint.localeCompare(right.fingerprint);

const buildFamilies = (
  candidates: JsxSubtreeCandidate[],
  options: ResolvedJsxDuplicationOptions,
): BuiltDuplicateJsxFamilies => {
  const bucketsByFingerprint = new Map<string, JsxSubtreeBucket>();
  for (const candidate of candidates) {
    if (candidate.metadata.nodeCount < options.minimumNodeCount) continue;
    if (candidate.metadata.depth < options.minimumDepth) continue;
    const existingBucket = bucketsByFingerprint.get(candidate.metadata.fingerprint);
    if (existingBucket) {
      existingBucket.occurrences.push(candidate.occurrence);
    } else {
      bucketsByFingerprint.set(candidate.metadata.fingerprint, {
        metadata: candidate.metadata,
        occurrences: [candidate.occurrence],
      });
    }
  }

  const families: DuplicateJsxSubtreeFamily[] = [];
  const familyProcessingLimit = Math.max(
    options.maxFamilies * JSX_DUPLICATION_FAMILY_PROCESSING_MULTIPLIER,
    options.maxFamilies + 1,
  );
  for (const bucket of bucketsByFingerprint.values()) {
    if (bucket.occurrences.length < options.minimumOccurrences) continue;
    bucket.occurrences.sort(compareOccurrences);
    const distinctFileCount = new Set(bucket.occurrences.map((occurrence) => occurrence.path)).size;
    if (distinctFileCount < options.minimumDistinctFiles) continue;
    if (distinctFileCount === 1) {
      const compositionRootOffsets = new Set<number>();
      for (const occurrence of bucket.occurrences) {
        if (occurrence.compositionRootStartOffset !== null) {
          compositionRootOffsets.add(occurrence.compositionRootStartOffset);
        }
      }
      if (compositionRootOffsets.size < 2) continue;
    }
    families.push({
      fingerprint: bucket.metadata.fingerprint,
      nodeCount: bucket.metadata.nodeCount,
      depth: bucket.metadata.depth,
      occurrenceCount: bucket.occurrences.length,
      distinctFileCount,
      estimatedRemovableNodeCount: bucket.metadata.nodeCount * (bucket.occurrences.length - 1),
      estimatedRemovableLineCount:
        bucket.occurrences.reduce(
          (total, occurrence) => total + occurrence.endLine - occurrence.startLine + 1,
          0,
        ) -
        Math.max(
          ...bucket.occurrences.map((occurrence) => occurrence.endLine - occurrence.startLine + 1),
        ),
      primaryOccurrence: bucket.occurrences[0],
      relatedOccurrences: bucket.occurrences.slice(1),
    });
    if (families.length > familyProcessingLimit) {
      break;
    }
  }
  return {
    families: suppressNestedFamilies(families).sort(compareFamilies),
  };
};

const buildResult = (input: BuildDuplicateJsxResultInput): DuplicateJsxSubtreesResult => {
  const builtFamilies = buildFamilies(input.candidates, input.options);
  return {
    families: builtFamilies.families.slice(0, input.options.maxFamilies),
    scannedSourceFileCount: input.scannedSourceFileCount,
    scannedJsxNodeCount: input.scannedJsxNodeCount,
    incomplete: input.incompleteReasons.length > 0,
    incompleteReasons: input.incompleteReasons,
  };
};

export const detectDuplicateJsxSubtrees = (
  sources: JsxDuplicationSource[],
  options: DetectDuplicateJsxSubtreesOptions = {},
): DuplicateJsxSubtreesResult => {
  const resolvedOptions = resolveOptions(options);
  const incompleteReasons: JsxDuplicationIncompleteReason[] = [];
  const sortedSources = [...sources].sort((left, right) => left.path.localeCompare(right.path));
  if (sortedSources.length > resolvedOptions.maxSourceFiles) {
    incompleteReasons.push({
      kind: "source-file-limit",
      limit: resolvedOptions.maxSourceFiles,
      observed: sortedSources.length,
    });
  }

  const candidates: JsxSubtreeCandidate[] = [];
  let scannedSourceFileCount = 0;
  let scannedJsxNodeCount = 0;
  for (const source of sortedSources.slice(0, resolvedOptions.maxSourceFiles)) {
    if (options.signal?.aborted) {
      incompleteReasons.push({ kind: "aborted", observed: scannedSourceFileCount });
      break;
    }
    const scannedSource = scanSource({
      source,
      options: resolvedOptions,
      signal: options.signal,
      scannedSourceFileCount,
      scannedJsxNodeCount,
    });
    if (scannedSource.incompleteReason !== null) {
      incompleteReasons.push(scannedSource.incompleteReason);
    }
    if (scannedSource.didAbort) break;
    if (!scannedSource.didScan) continue;
    candidates.push(...scannedSource.candidates);
    scannedJsxNodeCount += scannedSource.candidates.length;
    scannedSourceFileCount += 1;
  }
  return buildResult({
    candidates,
    options: resolvedOptions,
    incompleteReasons,
    scannedSourceFileCount,
    scannedJsxNodeCount,
  });
};

export const detectDuplicateJsxSubtreesCooperative = async (
  sourceReader: JsxDuplicationSourceReader,
  options: DetectDuplicateJsxSubtreesOptions = {},
): Promise<DuplicateJsxSubtreesResult> => {
  const resolvedOptions = resolveOptions(options);
  const incompleteReasons: JsxDuplicationIncompleteReason[] = [];
  const sortedPaths = [...sourceReader.paths].sort((left, right) => left.localeCompare(right));
  if (sortedPaths.length > resolvedOptions.maxSourceFiles) {
    incompleteReasons.push({
      kind: "source-file-limit",
      limit: resolvedOptions.maxSourceFiles,
      observed: sortedPaths.length,
    });
  }

  const candidates: JsxSubtreeCandidate[] = [];
  let scannedSourceFileCount = 0;
  let scannedJsxNodeCount = 0;
  for (const sourcePath of sortedPaths.slice(0, resolvedOptions.maxSourceFiles)) {
    if (options.signal?.aborted) {
      incompleteReasons.push({ kind: "aborted", observed: scannedSourceFileCount });
      break;
    }
    const sourceText = await sourceReader.read(sourcePath, resolvedOptions.maxSourceLengthChars);
    if (sourceText === null) continue;
    const source: JsxDuplicationSource = { path: sourcePath, sourceText };
    const scannedSource = scanSource({
      source,
      options: resolvedOptions,
      signal: options.signal,
      scannedSourceFileCount,
      scannedJsxNodeCount,
    });
    if (scannedSource.incompleteReason !== null) {
      incompleteReasons.push(scannedSource.incompleteReason);
    }
    if (scannedSource.didScan) {
      candidates.push(...scannedSource.candidates);
      scannedJsxNodeCount += scannedSource.candidates.length;
      scannedSourceFileCount += 1;
    }
    if (scannedSource.didAbort) break;
    await yieldToEventLoop();
  }

  return buildResult({
    candidates,
    options: resolvedOptions,
    incompleteReasons,
    scannedSourceFileCount,
    scannedJsxNodeCount,
  });
};
