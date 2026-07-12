import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingJsxOpeningElement } from "../../utils/find-enclosing-jsx-opening-element.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { hasClientRenderEvidence } from "../../utils/has-client-render-evidence.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { hasSuppressHydrationWarningAttribute } from "../../utils/has-suppress-hydration-warning-attribute.js";
import { isAfterClientOnlyEarlyReturn } from "../../utils/is-after-client-only-early-return.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// `toLocaleString` also lives on Number/BigInt (grouping separators differ
// by locale, so those mismatch too); the Date/Time variants are Date-only.
const LOCALE_FORMAT_METHOD_NAMES = new Set([
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
]);

const DATE_ONLY_LOCALE_METHOD_NAMES = new Set(["toLocaleDateString", "toLocaleTimeString"]);

// `NumberFormat` is deliberately absent — like bare `toLocaleString()` on a
// number, its only environment input is the ICU locale (grouping/decimal
// separators), a far weaker mismatch signal than the timezone shift every
// date formatter carries. Corpus evidence: every `Intl.NumberFormat()`
// render hit was a client-fetched dashboard count that never appears in
// server HTML.
const INTL_FORMATTER_NAMES = new Set(["DateTimeFormat", "RelativeTimeFormat"]);

const INTL_FORMAT_METHOD_NAMES = new Set(["format", "formatToParts", "formatRange"]);

interface LocaleFormatMatch {
  readonly node: EsTreeNode;
  readonly display: string;
}

const isProvableDateExpression = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  const unwrapped = stripParenExpression(expression);
  return (
    isNodeOfType(unwrapped, "NewExpression") &&
    isNodeOfType(unwrapped.callee, "Identifier") &&
    unwrapped.callee.name === "Date"
  );
};

// `count.toLocaleString()` on a number only mismatches when the server's
// ICU locale differs from the user's — real but far weaker than the
// timezone shift every date formatting carries (observed to be ~75% of
// corpus hits, almost all client-fetched dashboard numbers). Bare
// `toLocaleString()` therefore needs a date-shaped receiver: a provable
// `new Date(…)` or a date-flavored name (`createdAt`, `deadline`, …).
const DATE_FLAVORED_NAME_PATTERN =
  /(date|time|timestamp|deadline|created|updated|scheduled|expire|moment|when|birthday|dob)|(at)$/i;

const receiverNameLooksDateFlavored = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "Identifier")) {
    return DATE_FLAVORED_NAME_PATTERN.test(unwrapped.name);
  }
  if (isNodeOfType(unwrapped, "MemberExpression") && !unwrapped.computed) {
    return (
      isNodeOfType(unwrapped.property, "Identifier") &&
      DATE_FLAVORED_NAME_PATTERN.test(unwrapped.property.name)
    );
  }
  if (isNodeOfType(unwrapped, "CallExpression")) {
    // `row.getCreatedAt().toLocaleString()` / `parseDate(x).toLocaleString()`
    return receiverNameLooksDateFlavored(unwrapped.callee);
  }
  return false;
};

const objectLiteralHasProperty = (
  objectExpression: EsTreeNode | null | undefined,
  propertyName: string,
): boolean => {
  if (!objectExpression) return false;
  const unwrapped = stripParenExpression(objectExpression);
  if (!isNodeOfType(unwrapped, "ObjectExpression")) return false;
  for (const property of unwrapped.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;
    if (isNodeOfType(property.key, "Identifier") && property.key.name === propertyName) return true;
    if (isNodeOfType(property.key, "Literal") && property.key.value === propertyName) return true;
  }
  return false;
};

const hasExplicitLocaleArgument = (argument: EsTreeNode | null | undefined): boolean => {
  if (!argument) return false;
  const unwrapped = stripParenExpression(argument);
  if (isNodeOfType(unwrapped, "Identifier") && unwrapped.name === "undefined") return false;
  return true;
};

// `date.toLocaleString("en-US", { timeZone: "UTC" })` is deterministic —
// both renders format identically no matter where they run. A locale
// WITHOUT a timeZone still mismatches for dates (the server's zone shifts
// the rendered day/time), so only the Date-receiver shapes keep firing.
const isDeterministicLocaleMethodCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  methodName: string,
  receiverIsProvablyDate: boolean,
): boolean => {
  const localeArgument = call.arguments?.[0];
  if (!hasExplicitLocaleArgument(localeArgument)) return false;
  const optionsArgument = call.arguments?.[1];
  if (objectLiteralHasProperty(optionsArgument, "timeZone")) return true;
  // Explicit locale, no timeZone: still environment-dependent when the
  // receiver is a date. An unknown receiver could be a number (locale is
  // its only environment input), so stay quiet there.
  return !DATE_ONLY_LOCALE_METHOD_NAMES.has(methodName) && !receiverIsProvablyDate;
};

const matchLocaleMethodCall = (
  call: EsTreeNodeOfType<"CallExpression">,
): LocaleFormatMatch | null => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const methodName = callee.property.name;
  if (!LOCALE_FORMAT_METHOD_NAMES.has(methodName)) return null;
  const receiverIsProvablyDate = isProvableDateExpression(callee.object);
  if (
    methodName === "toLocaleString" &&
    !receiverIsProvablyDate &&
    !receiverNameLooksDateFlavored(callee.object)
  ) {
    return null;
  }
  if (isDeterministicLocaleMethodCall(call, methodName, receiverIsProvablyDate)) return null;
  return { node: call, display: `${methodName}()` };
};

const getIntlFormatterName = (expression: EsTreeNode | null | undefined): string | null => {
  if (!expression) return null;
  const unwrapped = stripParenExpression(expression);
  if (!isNodeOfType(unwrapped, "CallExpression") && !isNodeOfType(unwrapped, "NewExpression")) {
    return null;
  }
  const callee = unwrapped.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "Intl") return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  return INTL_FORMATTER_NAMES.has(callee.property.name) ? callee.property.name : null;
};

const isDeterministicIntlConstruction = (
  construction: EsTreeNode,
  formatterName: string,
): boolean => {
  if (
    !isNodeOfType(construction, "CallExpression") &&
    !isNodeOfType(construction, "NewExpression")
  ) {
    return false;
  }
  if (!hasExplicitLocaleArgument(construction.arguments?.[0])) return false;
  if (formatterName !== "DateTimeFormat") return true;
  return objectLiteralHasProperty(construction.arguments?.[1], "timeZone");
};

// `Intl.DateTimeFormat().format(date)` — direct chain, or through a
// same-scope const (`const formatter = new Intl.DateTimeFormat(); …
// formatter.format(date)`).
const matchIntlFormatCall = (
  call: EsTreeNodeOfType<"CallExpression">,
): LocaleFormatMatch | null => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  if (!INTL_FORMAT_METHOD_NAMES.has(callee.property.name)) return null;

  let construction: EsTreeNode | null | undefined = stripParenExpression(callee.object);
  if (isNodeOfType(construction, "Identifier")) {
    const binding = findVariableInitializer(construction, construction.name);
    construction = binding?.initializer ? stripParenExpression(binding.initializer) : null;
  }
  if (!construction) return null;
  const formatterName = getIntlFormatterName(construction);
  if (!formatterName) return null;
  if (isDeterministicIntlConstruction(construction, formatterName)) return null;
  return { node: call, display: `Intl.${formatterName}().${callee.property.name}()` };
};

// Date's default string form embeds the runtime timezone ("GMT-0700
// (Pacific Daylight Time)"). Only argument-carrying constructions match —
// bare `new Date()` is wall-clock nondeterminism and already owned by
// rendering-hydration-mismatch-time.
const isDeterministicInputDateConstruction = (
  expression: EsTreeNode | null | undefined,
): boolean => {
  if (!expression) return false;
  const unwrapped = stripParenExpression(expression);
  if (!isNodeOfType(unwrapped, "NewExpression")) return false;
  if (!isNodeOfType(unwrapped.callee, "Identifier") || unwrapped.callee.name !== "Date") {
    return false;
  }
  return (unwrapped.arguments?.length ?? 0) > 0;
};

const matchDateDefaultStringification = (node: EsTreeNode): LocaleFormatMatch | null => {
  if (isNodeOfType(node, "CallExpression")) {
    const callee = node.callee;
    // new Date(value).toString()
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "toString" &&
      isDeterministicInputDateConstruction(callee.object)
    ) {
      return { node, display: "Date.prototype.toString()" };
    }
    // String(new Date(value))
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "String" &&
      isDeterministicInputDateConstruction(node.arguments?.[0])
    ) {
      return { node, display: "String(new Date(…))" };
    }
    return null;
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    for (const expression of node.expressions ?? []) {
      if (isDeterministicInputDateConstruction(expression)) {
        return { node: expression, display: "`${new Date(…)}`" };
      }
    }
  }
  return null;
};

export const noLocaleFormatInRender = defineRule({
  id: "no-locale-format-in-render",
  title: "Locale/timezone formatting during render",
  severity: "warn",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Format locale/timezone-dependent values in a post-mount useEffect + state, or pass an explicit locale and timeZone so the server and the browser render the same text. Only runs on SSR-capable projects.",
  create: (context: RuleContext): RuleVisitors => {
    const isTestlikeFile = isTestlikeFilename(context.filename);
    if (isTestlikeFile) return {};
    // React Native has no server-rendered HTML to hydrate; skip files in
    // RN/Expo packages of mixed monorepos.
    if (classifyReactNativeFileTarget(context) === "react-native") return {};

    let fileHasUseClientDirective = false;
    let fileIsEmailTemplate = false;
    const reportedNodes = new Set<EsTreeNode>();

    const reportIfRenderPhase = (match: LocaleFormatMatch): void => {
      if (reportedNodes.has(match.node)) return;
      const componentOrHookNode = findRenderPhaseComponentOrHook(match.node, context.scopes);
      if (!componentOrHookNode) return;
      if (fileIsEmailTemplate) return;
      if (!hasClientRenderEvidence(componentOrHookNode, fileHasUseClientDirective)) return;
      if (isGatedByFalsyInitialState(match.node, context.scopes)) return;
      if (isAfterClientOnlyEarlyReturn(match.node, componentOrHookNode, context.scopes)) return;
      if (hasSuppressHydrationWarningAttribute(findEnclosingJsxOpeningElement(match.node))) return;
      if (
        isGeneratedImageRenderContext(
          context,
          findEnclosingJsxOpeningElement(match.node)?.parent ?? match.node,
        )
      ) {
        return;
      }
      reportedNodes.add(match.node);
      context.report({
        node: match.node,
        message: `This can cause a hydration mismatch because ${match.display} formats with the server's locale and timezone during server rendering but the user's in the browser. Format it in a post-mount useEffect, or pass an explicit locale and timeZone.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileHasUseClientDirective = hasDirective(node, "use client");
        fileIsEmailTemplate = hasEmailTemplateImport(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const match =
          matchLocaleMethodCall(node) ??
          matchIntlFormatCall(node) ??
          matchDateDefaultStringification(node);
        if (match) reportIfRenderPhase(match);
      },
      TemplateLiteral(node: EsTreeNodeOfType<"TemplateLiteral">) {
        const match = matchDateDefaultStringification(node);
        if (match) reportIfRenderPhase(match);
      },
      // A same-file helper called from JSX runs during render even though
      // its own body sits behind a plain function boundary — resolve one
      // level deep so `<td>{formatCreatedAt(row)}</td>` still reports the
      // locale call inside `formatCreatedAt`.
      JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
        const expression = stripParenExpression(node.expression);
        if (!isNodeOfType(expression, "CallExpression")) return;
        if (!isNodeOfType(expression.callee, "Identifier")) return;
        const helperName = expression.callee.name;
        const componentOrHookNode = findRenderPhaseComponentOrHook(node, context.scopes);
        if (!componentOrHookNode) return;
        const binding = findVariableInitializer(expression.callee, helperName);
        const helperNode = binding?.initializer;
        if (!helperNode || !isFunctionLike(helperNode)) return;
        if (componentOrHookDisplayNameForFunction(helperNode)) return;
        walkAst(helperNode.body ?? helperNode, (child: EsTreeNode) => {
          if (isFunctionLike(child)) return false;
          if (!isNodeOfType(child, "CallExpression")) return;
          const match = matchLocaleMethodCall(child) ?? matchIntlFormatCall(child);
          if (!match || reportedNodes.has(match.node)) return;
          if (fileIsEmailTemplate) return;
          if (!hasClientRenderEvidence(componentOrHookNode, fileHasUseClientDirective)) return;
          if (isGatedByFalsyInitialState(node, context.scopes)) return;
          if (isAfterClientOnlyEarlyReturn(node, componentOrHookNode, context.scopes)) return;
          if (hasSuppressHydrationWarningAttribute(findEnclosingJsxOpeningElement(node))) return;
          reportedNodes.add(match.node);
          context.report({
            node: match.node,
            message: `This can cause a hydration mismatch because ${match.display} (reached from JSX through "${helperName}") formats with the server's locale and timezone during server rendering but the user's in the browser. Format it in a post-mount useEffect, or pass an explicit locale and timeZone.`,
          });
        });
      },
    };
  },
});
