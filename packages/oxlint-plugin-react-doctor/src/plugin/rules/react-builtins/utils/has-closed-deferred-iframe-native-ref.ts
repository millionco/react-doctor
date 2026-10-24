import { HTML_TAGS } from "../../../constants/html-tags.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasRefNotificationReactCall } from "../../state-and-effects/utils/has-ref-notification-react-call.js";
import {
  DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT,
  DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT,
} from "./constants.js";

interface DeferredIframeRefModule extends SourceProjectModule {
  readonly sourceText: string;
}

export const hasClosedDeferredIframeNativeRef = (
  symbol: SymbolDescriptor,
  module: DeferredIframeRefModule,
  carrierClass: string,
): boolean => {
  const declaration = symbol.declarationNode;
  if (
    symbol.kind !== "const" ||
    isErasedTypeScriptBinding(symbol) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== symbol.bindingIdentifier ||
    !declaration.init ||
    !hasCompleteSymbolReferences(symbol, module.programNode, module.scopes)
  )
    return false;
  const call = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.arguments.length !== DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT ||
    !isNodeOfType(call.arguments[0], "Literal") ||
    call.arguments[0].value !== null ||
    !hasRefNotificationReactCall(
      call,
      "useRef",
      {
        filename: module.filePath,
        scopes: module.scopes,
        sourceCode: { getText: () => module.sourceText },
      },
      { allowNativeWindowEventListeners: true },
    )
  )
    return false;
  let attachments = 0;
  const valid = symbol.references.every((reference) => {
    if (isNonReferenceIdentifier(reference.identifier)) return true;
    if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier)) return false;
    let member = reference.identifier.parent;
    if (
      isNodeOfType(member, "JSXExpressionContainer") &&
      member.expression === reference.identifier &&
      isNodeOfType(member.parent, "JSXAttribute") &&
      isNodeOfType(member.parent.name, "JSXIdentifier") &&
      member.parent.name.name === "ref" &&
      isNodeOfType(member.parent.parent, "JSXOpeningElement") &&
      isNodeOfType(member.parent.parent.name, "JSXIdentifier") &&
      HTML_TAGS.has(member.parent.parent.name.name) &&
      !getAuthoritativeJsxAttribute(member.parent.parent.attributes, "is")
    ) {
      attachments++;
      return true;
    }
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== reference.identifier ||
      member.computed ||
      member.optional ||
      getStaticPropertyName(member) !== "current" ||
      !isNodeOfType(member.parent, "MemberExpression") ||
      member.parent.object !== member
    )
      return false;
    member = member.parent;
    if (member.computed || member.optional) return false;
    const name = getStaticPropertyName(member);
    if (name === "offsetWidth") return !isNodeOfType(member.parent, "CallExpression");
    if (name === "setAttribute") {
      const write = member.parent;
      return (
        isNodeOfType(write, "CallExpression") &&
        write.callee === member &&
        !write.optional &&
        write.arguments.length === DEFERRED_IFRAME_SOURCE_ARGUMENT_COUNT &&
        !write.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")) &&
        isNodeOfType(write.arguments[0], "Literal") &&
        (write.arguments[0].value === "height" ||
          (write.arguments[0].value === "src" &&
            isNodeOfType(write.arguments[1], "Literal") &&
            write.arguments[1].value === ""))
      );
    }
    if (name === "parentNode") {
      if (
        !isNodeOfType(member.parent, "MemberExpression") ||
        member.parent.object !== member ||
        member.parent.computed ||
        member.parent.optional
      )
        return false;
      member = member.parent;
    }
    if (
      getStaticPropertyName(member) !== "classList" ||
      !isNodeOfType(member.parent, "MemberExpression") ||
      member.parent.object !== member ||
      member.parent.computed ||
      member.parent.optional
    )
      return false;
    const invocation = member.parent.parent;
    return (
      isNodeOfType(invocation, "CallExpression") &&
      !invocation.optional &&
      invocation.callee === member.parent &&
      ["add", "remove", "toggle"].includes(getStaticPropertyName(member.parent) ?? "") &&
      invocation.arguments.length === DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT &&
      isNodeOfType(invocation.arguments[0], "Literal") &&
      typeof invocation.arguments[0].value === "string" &&
      !invocation.arguments[0].value.split(/\s+/u).includes(carrierClass)
    );
  });
  return valid && attachments === DEFERRED_IFRAME_SINGLE_ARGUMENT_COUNT;
};
