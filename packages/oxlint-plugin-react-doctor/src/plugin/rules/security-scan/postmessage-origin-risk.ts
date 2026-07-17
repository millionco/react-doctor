import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { getNodeEndIndex } from "../../utils/get-node-end-index.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { parseSourceText } from "../../utils/parse-source-file.js";
import { walkAst } from "../../utils/walk-ast.js";
import { escapeRegExp } from "./utils/escape-reg-exp.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";

// Any reference to an origin counts as a check: validation frequently lives
// in a called helper (`isTrustedOrigin(event)`) or a destructured binding.
// Substring match (not \b) so camelCase helper names count; `(?!al)` keeps
// `original` from counting. `event.source ===` comparisons against a known
// window are an equivalent sender check.
const POSTMESSAGE_ORIGIN_CHECK_PATTERN = /origin(?!al)|\.source\s*[!=]==?/i;

const MESSAGE_DATA_READ_PATTERN = /\b(?:event|e|evt|msg|message)\.data\b/;

// True when the text immediately before the first `event.data` is a
// `const`/`let`/`var` declaration's initializer — i.e. the data is being READ
// INTO A LOCAL (`const data = event.data`) rather than used directly. The
// local isn't consumed until later, so an origin guard placed anywhere after
// the binding (the read-then-guard-then-use idiom) still protects the use.
const MESSAGE_DATA_BINDING_PATTERN = /\b(?:const|let|var)\s+[^;=]*=\s*$/;

// MessagePort/Worker/BroadcastChannel/EventSource/WebSocket message events
// are same-application or server-stream channels; window-origin checks
// neither exist nor apply there. `self.onmessage` is the worker-global
// handler idiom (`_self` is the Prism-style polyfill for it). Substring
// match (no left \b) so camelCase receivers like `tokenChannel.onmessage`
// count; `^source\.` is the EventSource idiom.
const SAME_APPLICATION_CHANNEL_TARGET_PATTERN =
  /port\d?\b|worker|channel|broadcast|socket|\bws\b|\bsse\b|eventsource|^_?self\.|^source\./i;

// A receiver whose NAME says nothing (`es.onmessage`, `g.onmessage`) can
// still be a same-application channel — resolve the identifier to its
// constructor (`const es = new EventSource(url)`, `let g = new Worker(...)`)
// anywhere in the file.
const SAME_APPLICATION_CHANNEL_CONSTRUCTOR_SOURCE = String.raw`=\s*new\s+(?:EventSource|WebSocket|Worker|SharedWorker|BroadcastChannel|MessageChannel)\b`;

const isSameApplicationChannelInstance = (targetText: string, fileContent: string): boolean => {
  const receiverRoot = /^[\w$]+/.exec(targetText)?.[0];
  if (receiverRoot === undefined) return false;
  const constructorAssignmentPattern = new RegExp(
    `(?<![\\w$.])${escapeRegExp(receiverRoot)}\\s*${SAME_APPLICATION_CHANNEL_CONSTRUCTOR_SOURCE}`,
  );
  return constructorAssignmentPattern.test(fileContent);
};

const WORKER_FILE_PATH_PATTERN = /worker/i;

const getNodeText = (content: string, node: EsTreeNode): string => {
  const startIndex = getNodeStartIndex(node);
  const endIndex = getNodeEndIndex(node);
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
    if (!file.content.includes("addEventListener") && !file.content.includes("onmessage")) {
      return [];
    }
    const ast = parseSourceText({
      filename: file.absolutePath,
      sourceText: file.content,
      shouldAttachParentReferences: false,
    });
    if (ast === null) return [];

    const findings: ScanFinding[] = [];
    walkAst(ast, (node) => {
      const targetText = getMessageHandlerTarget(file.content, node);
      if (targetText === null) return;
      if (SAME_APPLICATION_CHANNEL_TARGET_PATTERN.test(targetText)) return;
      if (isSameApplicationChannelInstance(targetText, file.content)) return;

      const nodeText = getNodeText(file.content, node);
      const messageDataIndex = nodeText.search(MESSAGE_DATA_READ_PATTERN);
      if (messageDataIndex < 0) return;
      const originCheckIndex = nodeText.search(POSTMESSAGE_ORIGIN_CHECK_PATTERN);
      if (originCheckIndex >= 0) {
        // When the data is bound to a local first, the guard protects the
        // later use regardless of textual order (read-then-guard-then-use).
        // When the data is used directly, the guard must precede that use.
        if (MESSAGE_DATA_BINDING_PATTERN.test(nodeText.slice(0, messageDataIndex))) return;
        if (originCheckIndex < messageDataIndex) return;
      }

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
