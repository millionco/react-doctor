import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";

// Any reference to an origin counts as a check: validation frequently lives
// in a called helper (`isTrustedOrigin(event)`) or a destructured binding.
// Substring match (not \b) so camelCase helper names count; `(?!al)` keeps
// `original` from counting. `event.source ===` comparisons against a known
// window are an equivalent sender check.
const POSTMESSAGE_ORIGIN_CHECK_PATTERN = /origin(?!al)|\.source\s*[!=]==?/i;

const MESSAGE_DATA_READ_PATTERN = /\b(?:event|e|evt|msg|message)\.data\b/;

// MessagePort/Worker/BroadcastChannel/EventSource/WebSocket message events
// are same-application or server-stream channels; window-origin checks
// neither exist nor apply there. `self.onmessage` is the worker-global
// handler idiom. Substring match (no left \b) so camelCase receivers like
// `tokenChannel.onmessage` count; `^source\.` is the EventSource idiom.
const SAME_APPLICATION_CHANNEL_TARGET_PATTERN =
  /port\d?\b|worker|channel|broadcast|socket|\bws\b|\bsse\b|eventsource|^self\.|^source\./i;

const WORKER_FILE_PATH_PATTERN = /worker/i;

// oxc's parseSync emits ESTree byte offsets as `start`/`end` (it never
// populates `range`), which TSESTree's types don't declare — so read
// them structurally.
const getNodeStartIndex = (node: EsTreeNode): number =>
  "start" in node && typeof node.start === "number" ? node.start : -1;

const getNodeText = (content: string, node: EsTreeNode): string => {
  const startIndex = getNodeStartIndex(node);
  const endIndex = "end" in node && typeof node.end === "number" ? node.end : -1;
  if (startIndex < 0 || endIndex < 0) return "";
  return content.slice(startIndex, endIndex);
};

// Returns the listener target (the `window.addEventListener` callee text or
// the `window.onmessage` assignment target) when `node` registers a message
// handler, and null otherwise.
const getMessageHandlerTarget = (content: string, node: EsTreeNode): string | null => {
  if (node.type === "CallExpression") {
    const calleeText = isAstNode(node.callee) ? getNodeText(content, node.callee) : "";
    if (!calleeText.endsWith("addEventListener")) return null;
    const firstArgument = node.arguments[0];
    const isMessageEvent =
      isAstNode(firstArgument) &&
      firstArgument.type === "Literal" &&
      firstArgument.value === "message";
    return isMessageEvent ? calleeText : null;
  }
  if (node.type === "AssignmentExpression" && isAstNode(node.left)) {
    const leftText = getNodeText(content, node.left);
    return leftText.endsWith(".onmessage") ? leftText : null;
  }
  return null;
};

export const postmessageOriginRisk = defineRule({
  id: "postmessage-origin-risk",
  title: "postMessage handler without origin check",
  severity: "warn",
  recommendation:
    "Validate `event.origin` against an exact allowlist before using `event.data`, especially when an iframe or parent window can be attacker-controlled.",
  scan: (file) => {
    if (!isProductionSourcePath(file.relativePath)) return [];
    if (WORKER_FILE_PATH_PATTERN.test(file.relativePath)) return [];
    const ast = parseSourceText(file.absolutePath, file.content);
    if (ast === null) return [];

    const findings: ScanFinding[] = [];
    walkAst(ast, (node) => {
      const targetText = getMessageHandlerTarget(file.content, node);
      if (targetText === null) return;
      if (SAME_APPLICATION_CHANNEL_TARGET_PATTERN.test(targetText)) return;

      const nodeText = getNodeText(file.content, node);
      const messageDataIndex = nodeText.search(MESSAGE_DATA_READ_PATTERN);
      if (messageDataIndex < 0) return;
      const originCheckIndex = nodeText.search(POSTMESSAGE_ORIGIN_CHECK_PATTERN);
      if (originCheckIndex >= 0 && originCheckIndex < messageDataIndex) return;

      const location = getLocationAtIndex(file.content, getNodeStartIndex(node));
      findings.push({
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: location.line,
        column: location.column,
      });
    });

    return findings;
  },
});
