# Proposal: `react-doctor/no-inline-prefetch-auth`

> **Status**: 🟡 Auto-discovered draft proposal from a curated **knowledge-base** principle. **Not yet implemented.** Maintainer review wanted before any code lands.

|                        |                                |
| ---------------------- | ------------------------------ |
| Category               | `react-native`                 |
| Severity               | `warn`                         |
| Source cluster         | `NEW::no-inline-prefetch-auth` |
| Backing evidence units | 1                              |

## Why the bug exists

> Developers often assume the Authorization expression will be evaluated when the prefetch runs. App-start prefetch queues are replayed by native code before JS starts, so a JS-supplied token is just a persisted snapshot that may already be stale.

## Generality check

> Any React Native codebase using a native app-start prefetch queue has the same cold-start boundary: native replay cannot call JS to refresh credentials. The detector keys on the public prefetch API and standard Authorization header shape, not on app-specific endpoints, token variable names, or domains.

## Sources

Discovered by the [react-doctor-evals discovery flywheel](https://github.com/millionco/react-doctor-evals/pull/11) via a new **knowledge-doc evidence source** that mines curated principle libraries (this evidence comes from the [react-doctor-knowledge-base](https://github.com/millionco/react-doctor-knowledge-base) repo). Pipeline:

```
knowledge-base markdown -> heading-anchored section split -> EvidenceUnit (KnowledgeDocMeta) -> DraftAgent (gpt-5.5, xhigh reasoning) -> RuleDedupe -> THIS PR
```

### Backing principle

- Skill: **nitro-fetch** — section _Fetching tokens for cross-start prefetches_ of `Prefetching with nitro-fetch`

## Validation prompt

FP-aware guidance for the [react-review agent](https://github.com/millionco/react-review):

> Confirm the prefetch is an app-start prefetch whose Authorization header is an expiring access token minted or read by JS. False positives include a static Basic/API-key Authorization credential that is intentionally valid across cold starts, and library wrapper/test code that deliberately verifies raw header persistence.

## Fix prompt

> Move access-token minting into the native token refresh registration, then remove Authorization from each queued app-start prefetch. Keep the prefetch options focused on the URL and queue metadata. Example: `registerTokenRefresh({ url: TOKEN_URL, method: "POST", responseType: "json", mappings: [{ jsonPath: "access_token", header: "Authorization", valueTemplate: "Bearer {{value}}" }] }); await prefetchOnAppStart(feedUrl, { prefetchKey: "feed" });`

## Positive fixture (SHOULD trigger)

```tsx
import { prefetchOnAppStart } from "react-native-nitro-fetch";

export async function scheduleFeed(token: string) {
  await prefetchOnAppStart("https://api.example.com/feed", {
    prefetchKey: "feed",
    headers: { Authorization: `Bearer ${token}` },
  });
}
```

## Negative fixture (should NOT trigger)

```tsx
import { prefetchOnAppStart, registerTokenRefresh } from "react-native-nitro-fetch";

registerTokenRefresh({
  url: "https://api.example.com/oauth/token",
  method: "POST",
  responseType: "json",
  mappings: [
    { jsonPath: "access_token", header: "Authorization", valueTemplate: "Bearer {{value}}" },
  ],
});

export async function scheduleFeed() {
  await prefetchOnAppStart("https://api.example.com/feed", { prefetchKey: "feed" });
}
```

## Proposed AST detector

Would land at `packages/oxlint-plugin-react-doctor/src/plugin/rules/react-native/no-inline-prefetch-auth.ts`:

```ts
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const NITRO_FETCH_PACKAGE_NAME = "react-native-nitro-fetch";
const PREFETCH_ON_APP_START_NAME = "prefetchOnAppStart";
const AUTHORIZATION_HEADER_NAMES = new Set(["authorization", "proxy-authorization"]);

const getStaticPropertyName = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property")) return null;

  const key = property.key;
  if (!property.computed && isNodeOfType(key, "Identifier")) return key.name;
  if (isNodeOfType(key, "Literal") && typeof key.value === "string") return key.value;
  if (isNodeOfType(key, "TemplateLiteral")) return getStaticTemplateLiteralValue(key);

  return null;
};

const getObjectPropertyValue = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): EsTreeNode | null => {
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const keyName = getStaticPropertyName(property);
    if (keyName?.toLowerCase() !== propertyName) continue;
    return property.value;
  }

  return null;
};

const isLikelyExpiringAuthorizationValue = (value: EsTreeNode): boolean => {
  if (isNodeOfType(value, "Literal")) {
    if (typeof value.value !== "string") return false;
    return value.value.toLowerCase().includes("bearer");
  }

  if (isNodeOfType(value, "TemplateLiteral")) {
    const staticValue = getStaticTemplateLiteralValue(value);
    if (staticValue) return staticValue.toLowerCase().includes("bearer");
    return true;
  }

  if (isNodeOfType(value, "Identifier") && value.name === "undefined") return false;

  return true;
};

const objectExpressionHasAuthorizationHeader = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): boolean => {
  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    const keyName = getStaticPropertyName(property);
    if (!keyName || !AUTHORIZATION_HEADER_NAMES.has(keyName.toLowerCase())) continue;
    if (isLikelyExpiringAuthorizationValue(property.value)) return true;
  }

  return false;
};

const expressionHasAuthorizationHeader = (expression: EsTreeNode): boolean => {
  if (isNodeOfType(expression, "ObjectExpression")) {
    return objectExpressionHasAuthorizationHeader(expression);
  }

  if (!isNodeOfType(expression, "NewExpression")) return false;
  if (!isNodeOfType(expression.callee, "Identifier") || expression.callee.name !== "Headers") {
    return false;
  }

  const initArgument = expression.arguments?.[0];
  return Boolean(
    initArgument &&
    isNodeOfType(initArgument, "ObjectExpression") &&
    objectExpressionHasAuthorizationHeader(initArgument),
  );
};

export const noInlinePrefetchAuth = defineRule<Rule>({
  id: "no-inline-prefetch-auth",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use native token refresh registration for app-start prefetch Authorization headers instead of persisting JS-minted tokens in the queued request",
  create: (context: RuleContext) => {
    const prefetchOnAppStartLocalNames = new Set<string>();
    const nitroFetchNamespaceNames = new Set<string>();

    const isPrefetchOnAppStartCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
      const callee = node.callee;
      if (isNodeOfType(callee, "Identifier")) {
        return prefetchOnAppStartLocalNames.has(callee.name);
      }

      if (!isNodeOfType(callee, "MemberExpression")) return false;
      if (callee.computed) return false;
      if (!isNodeOfType(callee.object, "Identifier")) return false;
      if (!nitroFetchNamespaceNames.has(callee.object.name)) return false;
      return (
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === PREFETCH_ON_APP_START_NAME
      );
    };

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (node.source?.value !== NITRO_FETCH_PACKAGE_NAME) return;

        for (const specifier of node.specifiers ?? []) {
          if (isNodeOfType(specifier, "ImportSpecifier")) {
            if (getImportedName(specifier) === PREFETCH_ON_APP_START_NAME) {
              prefetchOnAppStartLocalNames.add(specifier.local.name);
            }
            continue;
          }

          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            nitroFetchNamespaceNames.add(specifier.local.name);
          }
        }
      },

      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isPrefetchOnAppStartCall(node)) return;

        const optionsArgument = node.arguments?.[1];
        if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return;

        const headersExpression = getObjectPropertyValue(optionsArgument, "headers");
        if (!headersExpression || !expressionHasAuthorizationHeader(headersExpression)) return;

        context.report({
          node: headersExpression,
          message:
            "Authorization header queued in prefetchOnAppStart() can be stale on cold start because native replay runs before JS; register a native token refresh and let it inject the header",
        });
      },
    };
  },
});
```

---

<sub>
Generated by `rde discover ingest-knowledge` + `rde discover draft` (v3 knowledge-aware prompt: AST-detectability check + WHY-reasoning + generality check + explicit abstain). See [millionco/react-doctor-evals#11](https://github.com/millionco/react-doctor-evals/pull/11) for the pipeline.
</sub>
