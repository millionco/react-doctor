import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const EMPTY_VISITORS: RuleVisitors = {};

// Node/build-time and server files legitimately read `process.env`
// dynamically (they run in Node, not the bundled client, so Metro never
// inlines them). The OSS corpus showed nearly every computed / destructured
// `process.env` access lives in exactly these files — config, scripts/tooling,
// CLI entry points, Expo Router server routes (`*+api`), `*.server.*` modules,
// and tests — so excluding them is what keeps this rule low-noise.
const NODE_OR_BUILD_FILE =
  /(\.config\.[cm]?[jt]sx?$)|((^|\/)(scripts|tools|tooling|cli|bin)\/)|(\+(api|html)\.[cm]?[jt]sx?$)|(\.server\.[cm]?[jt]sx?$)|(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)__tests__\/)|(\.e2e\.[cm]?[jt]sx?$)/;

// A computed key that is a string literal NOT starting with `EXPO_PUBLIC_`.
// These are overwhelmingly runtime/tooling probes — `process.env["JEST_WORKER_ID"]`,
// `process.env["EXPO_DEBUG"]`, debug flags — read defensively (often behind a
// `typeof process.env[...] === "string"` guard) and deliberately expected to be
// absent in the bundled app. Only `EXPO_PUBLIC_*` keys are the inlinable config
// the rule targets, so a non-`EXPO_PUBLIC_` literal key is skipped. Dynamic
// (non-literal) keys still flag.
const isNonExpoPublicLiteralKey = (key: EsTreeNode): boolean =>
  isNodeOfType(key, "Literal") &&
  typeof key.value === "string" &&
  !key.value.startsWith("EXPO_PUBLIC_");

// True for the `process.env` member access (`process` . `env`, static).
// `isNodeOfType` null-guards, so a null/undefined node is handled without an
// extra `Boolean(node)` check.
const isProcessEnv = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.object, "Identifier") &&
  node.object.name === "process" &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "env";

// HACK: `babel-preset-expo` inlines `process.env.EXPO_PUBLIC_*` (and other
// env reads) at build time by statically matching `process.env.NAME`.
// Computed access (`process.env[key]`) and destructuring
// (`const { NAME } = process.env`) defeat that static match, so the value
// ends up `undefined` in the bundled app. Ports eslint-config-expo's
// `no-dynamic-env-var` + `no-env-var-destructuring` (both errors there).
export const expoNoNonInlinedEnv = defineRule<Rule>({
  id: "expo-no-non-inlined-env",
  title: "Non-inlinable process.env access (Expo)",
  requires: ["expo"],
  severity: "warn",
  recommendation:
    "Read env vars with static dotted access (`process.env.EXPO_PUBLIC_NAME`). Computed access and destructuring aren't inlined by babel-preset-expo and resolve to `undefined` at runtime.",
  create: (context: RuleContext) => {
    const filename = normalizeFilename(context.filename ?? "");
    if (filename && NODE_OR_BUILD_FILE.test(filename)) return EMPTY_VISITORS;

    return {
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        if (!node.computed) return;
        if (!isProcessEnv(node.object)) return;
        // Skip literal non-`EXPO_PUBLIC_` keys (runtime/tooling probes).
        if (isNonExpoPublicLiteralKey(node.property)) return;
        context.report({
          node,
          message:
            "Computed `process.env[...]` access isn't inlined by babel-preset-expo and is `undefined` at runtime. Use static `process.env.EXPO_PUBLIC_NAME`.",
        });
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.id, "ObjectPattern")) return;
        if (!isProcessEnv(node.init)) return;
        context.report({
          node,
          message:
            "Destructuring `process.env` isn't inlined by babel-preset-expo, so the values are `undefined` at runtime. Read each var via `process.env.EXPO_PUBLIC_NAME`.",
        });
      },
    };
  },
});
