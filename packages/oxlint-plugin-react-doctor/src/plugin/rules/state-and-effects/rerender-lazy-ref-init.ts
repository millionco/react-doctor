import { BUILTIN_GLOBAL_NAMESPACE_NAMES } from "../../constants/js.js";
import { BUILTIN_HOOK_NAMES, TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getGlobalRequireModuleSource } from "../../utils/get-global-require-module-source.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../utils/has-static-property-write-before.js";
import { isReactNamespaceImport } from "../../utils/is-react-api-call.js";
import { isReactHookCapabilityValue } from "../../utils/is-react-hook-capability-value.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../utils/is-proven-global-namespace-reference.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const EMPTY_REGISTRY_CONSTRUCTOR_NAMES = ["Map", "Set", "WeakMap", "WeakSet"];
const DYNAMIC_CODE_RECOVERY_PROPERTY_NAMES = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "getPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
]);

export const rerenderLazyRefInit = defineRule({
  id: "rerender-lazy-ref-init",
  title: "Ref initializer runs on every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Initialize the ref lazily so expensive values are not rebuilt and discarded on every render.",
  create: (context: RuleContext) => {
    let hasAlternativeReactProvider = false;
    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        walkAst(programNode, (candidate) => {
          if (hasAlternativeReactProvider) return false;
          if (isNodeOfType(candidate, "MemberExpression") || isNodeOfType(candidate, "Property")) {
            const propertyName = getStaticPropertyKeyName(candidate, { allowComputedString: true });
            if (propertyName === null || DYNAMIC_CODE_RECOVERY_PROPERTY_NAMES.has(propertyName)) {
              hasAlternativeReactProvider = true;
              return false;
            }
          }
          if (
            isNodeOfType(candidate, "Identifier") &&
            context.scopes.referenceFor(candidate) &&
            isProvenGlobalObjectReference(candidate, context.scopes)
          ) {
            const expressionRoot = findTransparentExpressionRoot(candidate);
            const consumer = expressionRoot.parent;
            const staticMemberName = isNodeOfType(consumer, "MemberExpression")
              ? getStaticPropertyName(consumer)
              : null;
            const isClosedStaticMember =
              isNodeOfType(consumer, "MemberExpression") &&
              consumer.object === expressionRoot &&
              staticMemberName !== null &&
              BUILTIN_GLOBAL_NAMESPACE_NAMES.has(staticMemberName);
            const isTypeofReference =
              isNodeOfType(consumer, "UnaryExpression") &&
              consumer.operator === "typeof" &&
              consumer.argument === expressionRoot;
            if (!isClosedStaticMember && !isTypeofReference) {
              hasAlternativeReactProvider = true;
              return false;
            }
          }
          if (
            (isNodeOfType(candidate, "Identifier") ||
              isNodeOfType(candidate, "MemberExpression")) &&
            (isProvenGlobalNamespaceReference(candidate, "Reflect", context.scopes) ||
              isProvenGlobalNamespaceReference(candidate, "eval", context.scopes) ||
              isProvenGlobalNamespaceReference(candidate, "Function", context.scopes) ||
              isProvenGlobalNamespaceReference(candidate, "module", context.scopes) ||
              (isNodeOfType(candidate, "MemberExpression") &&
                isProvenGlobalNamespaceReference(candidate, "require", context.scopes)))
          ) {
            hasAlternativeReactProvider = true;
            return false;
          }
          if (
            isNodeOfType(candidate, "Identifier") &&
            candidate.name === "require" &&
            context.scopes.isGlobalReference(candidate) &&
            (!isNodeOfType(candidate.parent, "CallExpression") ||
              candidate.parent.callee !== candidate)
          ) {
            hasAlternativeReactProvider = true;
            return false;
          }
          if (
            isNodeOfType(candidate, "TSExternalModuleReference") &&
            (!isNodeOfType(candidate.expression, "Literal") ||
              candidate.expression.value === "react")
          ) {
            hasAlternativeReactProvider = true;
            return false;
          }
          if (
            isNodeOfType(candidate, "ImportDeclaration") &&
            (candidate.source.value === "module" || candidate.source.value === "node:module")
          ) {
            hasAlternativeReactProvider = true;
            return false;
          }
          if (
            !isNodeOfType(candidate, "CallExpression") &&
            !isNodeOfType(candidate, "ImportExpression")
          ) {
            return;
          }
          const moduleSource = getGlobalRequireModuleSource(candidate, context.scopes);
          if (
            moduleSource === "react" ||
            (isNodeOfType(candidate, "ImportExpression") &&
              (!isNodeOfType(candidate.source, "Literal") || candidate.source.value === "react"))
          ) {
            hasAlternativeReactProvider = true;
            return false;
          }
          if (!isNodeOfType(candidate, "CallExpression")) return;
          const candidateCallee = stripParenExpression(candidate.callee);
          if (
            moduleSource === null &&
            (isProvenGlobalNamespaceReference(candidateCallee, "require", context.scopes) ||
              (isNodeOfType(candidateCallee, "MemberExpression") &&
                getStaticPropertyName(candidateCallee) === "require" &&
                isProvenGlobalNamespaceReference(candidateCallee.object, "module", context.scopes)))
          ) {
            hasAlternativeReactProvider = true;
          }
        });
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isReactHookCall(node, "useRef", context.scopes) || !node.arguments?.length) return;
        const initializer = stripParenExpression(node.arguments[0]);

        const isPlainCall = isNodeOfType(initializer, "CallExpression");
        const isNewCall = isNodeOfType(initializer, "NewExpression");
        if (!isPlainCall && !isNewCall) return;

        const callee = initializer.callee;
        const memberPropertyName =
          isNodeOfType(callee, "MemberExpression") &&
          (isNodeOfType(callee.property, "Identifier") ||
            isNodeOfType(callee.property, "PrivateIdentifier"))
            ? callee.property.name
            : null;
        const calleeName = isNodeOfType(callee, "Identifier")
          ? callee.name
          : (memberPropertyName ?? "fn");

        if (TRIVIAL_INITIALIZER_NAMES.has(calleeName)) return;

        if (
          isNewCall &&
          initializer.arguments.length === 0 &&
          EMPTY_REGISTRY_CONSTRUCTOR_NAMES.some((constructorName) =>
            isProvenGlobalNamespaceReference(callee, constructorName, context.scopes),
          )
        ) {
          return;
        }

        if (isPlainCall && isReactHookName(calleeName)) return;
        if (
          isPlainCall &&
          !hasAlternativeReactProvider &&
          isReactHookCall(initializer, BUILTIN_HOOK_NAMES, context.scopes) &&
          isReactHookCapabilityValue(callee, context.scopes)
        ) {
          const hookReference = resolveImportedApiReference(callee, context.scopes);
          const hookName = hookReference?.importedName;
          if (
            hookReference?.source === "react" &&
            hookName &&
            !context.scopes.rootScope.symbols.some(
              (symbol) =>
                getImportDeclarationForSymbol(symbol)?.source.value === hookReference.source &&
                isReactNamespaceImport(symbol.bindingIdentifier, context.scopes) &&
                hasPossibleStaticPropertyMutationOrEscape(
                  symbol.bindingIdentifier,
                  hookName,
                  context.scopes,
                ),
            )
          ) {
            return;
          }
        }

        const callShape = isNewCall ? `new ${calleeName}()` : `${calleeName}()`;

        context.report({
          node: initializer,
          message: `useRef(${callShape}) rebuilds this value on every render & throws it away.`,
        });
      },
    };
  },
});
