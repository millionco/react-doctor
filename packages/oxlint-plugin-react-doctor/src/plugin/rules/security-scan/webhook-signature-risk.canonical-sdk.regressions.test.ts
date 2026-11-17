import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { SHOPIFY_PROVIDER_TEST_MTIME_SECONDS } from "../../../test-utils/shopify-webhook-proof/constants.js";
import type { ScannedFile } from "../../utils/file-scan.js";
import { webhookSignatureRisk } from "./webhook-signature-risk.js";

interface ShopifyGateCase {
  name: string;
  relativePath: string;
  files: Record<string, string>;
  expected: number;
}

const cases: ReadonlyArray<ShopifyGateCase> = [
  {
    name: "canonical-one-relative-provider-single-self-spread",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nlet client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nclient = { ...client, user: { entries: [] } };\nexport default client;\n',
    },
    expected: 0,
  },
  {
    name: "canonical-one-relative-readonly-const-provider",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 0,
  },
  {
    name: "direct-infile-actual-sdk-factory",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 0,
  },
  {
    name: "direct-invalid-return-gate",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (!outcome.valid) return response.status(400).send("rejected");\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 0,
  },
  {
    name: "no-validation-call",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    await applyPayload("sample-topic", request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "custom-local-same-method-spelling",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'const client = { webhooks: { validate: async () => ({ valid: true, topic: "sample" }) } };\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "foreign-package-same-factory-name",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "synthetic-sdk-lookalike";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "type-only-sdk-factory-import",
    relativePath: "server/webhooks/route.ts",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.ts":
        'import client from "../client.ts";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.ts":
        'import type { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "selected-method-direct-replacement",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nclient.webhooks.validate = async () => ({ valid: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "second-sdk-namespace-provider-write",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import * as secondary from "@shopify/shopify-api";\nimport { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nsecondary.shopifyApi = replacement;\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "ignored-validation-result",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    await applyPayload("sample-topic", request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "payload-action-before-validation",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    await applyPayload("early", request.body);\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "validation-of-different-request",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: otherRequest, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "missing-valid-discriminant-gate",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "catch-fail-open-payload-action",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    await applyPayload("failed", request.body);\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "optional-sdk-method-call",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate?.({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "computed-sdk-method-selector",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks["validate"]({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "duplicate-raw-body-property",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawBody: otherBody, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "validation-result-alias-mutation",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    const changed = outcome;\n    changed.valid = true;\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "second-unguarded-handler",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\nexport const POST = async request => applyPayload("other", request.body);\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "opaque-client-transport",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\npublishClient(client);\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "self-spread-overrides-webhooks",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nlet client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nclient = { ...client, webhooks: { validate: async () => ({ valid: true }) } };\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "self-spread-webhooks-accessor",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nlet client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nclient = { ...client, get webhooks() { return replacement; } };\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "module-runtime-eval-channel",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'eval("client.webhooks.validate = replacement");\nimport client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "missing-relative-provider",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
    },
    expected: 1,
  },
  {
    name: "factory-config-without-secret-field",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "unresolved-computed-native-callable-carrier",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'const selector = suppliedName;\nconst carrier = {}[selector];\ncarrier.assign(client.webhooks, { validate: replacement });\nimport client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "finally-payload-action-even-on-invalid",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  } finally {\n    await applyPayload("finally", request.body);\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "request-body-write-before-validation",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  request.body = "changed";\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "request-body-write-after-validation",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    request.body = "changed";\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "provider-api-secret-getter",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, get apiSecretKey() { return process.env.SYNTHETIC_API_SECRET; }, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "provider-client-alias-transport",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nconst alias = client;\nconsumeClient(alias);\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "selected-factory-alias",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst makeClient = shopifyApi;\nconst client = makeClient({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "destructured-reflection-portal",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'const { getPrototypeOf: readPrototype } = unknownCarrier;\nconsumeClient(readPrototype(""));\nimport client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "resolved-constructor-selector-portal",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'const propertyName = "constructor";\nconst carrier = ""[propertyName];\nconsumeClient(carrier);\nimport client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "unresolved-primitive-selector-portal",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'const propertyName = unknownName;\nconst carrier = (false || "")[propertyName];\nconsumeClient(carrier);\nimport client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "finally-body-action",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  } finally {\n    await applyPayload("unguarded", request.body);\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "second-nonexported-handler-registration",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n\nconst otherHandler = async (request, response) => applyPayload("unguarded", request.body);\nregisterRoute(otherHandler);\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "nested-request-transport",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    const exposeRequest = () => consumeClient(request);\n    exposeRequest();\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "provider-extension-getter",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nlet client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nclient = { ...client, get user() { return { entries: [] }; } };\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "same-program-client-sibling-procedural-initializer",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true }), ignored = opaque();\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "provider-client-sibling-procedural-initializer",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n};\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true }), ignored = opaque();\nexport default client;\n',
    },
    expected: 1,
  },
  {
    name: "handler-sibling-procedural-initializer",
    relativePath: "server/webhooks/route.js",
    files: {
      "package.json":
        '{\n  "name": "synthetic-sdk-webhook-route",\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@shopify/shopify-api": "13.0.0"\n  }\n}\n',
      "server/webhooks/route.js":
        'import client from "../client.js";\nconst webhookHandler = async (request, response) => {\n  try {\n    const outcome = await client.webhooks.validate({ rawBody: request.body, rawRequest: request, rawResponse: response });\n    if (outcome.valid) {} else { return response.status(400).send("rejected"); }\n    await applyPayload(outcome.topic, request.body);\n    return response.status(200).send("done");\n  } catch (failure) {\n    return response.status(500).send("failed");\n  }\n}, ignored = opaque();\nexport default webhookHandler;\n',
      "server/client.js":
        'import { shopifyApi } from "@shopify/shopify-api";\nimport "@shopify/shopify-api/adapters/node";\nconst client = shopifyApi({ apiKey: process.env.SYNTHETIC_API_KEY, apiSecretKey: process.env.SYNTHETIC_API_SECRET, scopes: ["read_products"], hostName: "synthetic.invalid", apiVersion: "2025-01", isEmbeddedApp: true });\nexport default client;\n',
    },
    expected: 1,
  },
];

const withCase = (
  selectedCase: ShopifyGateCase,
  inspect: (file: ScannedFile, root: string) => void,
): void => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "canonical-sdk-webhook-")));
  try {
    for (const [relativePath, content] of Object.entries(selectedCase.files)) {
      const filename = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, content);
    }
    const absolutePath = path.join(root, selectedCase.relativePath);
    inspect(
      {
        absolutePath,
        relativePath: selectedCase.relativePath,
        content: fs.readFileSync(absolutePath, "utf8"),
        isGeneratedBundle: false,
      },
      root,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

describe("closed canonical SDK webhook validation gate", () => {
  for (const selectedCase of cases) {
    it(selectedCase.name, () =>
      withCase(selectedCase, (file) => {
        expect(webhookSignatureRisk.scan?.(file)).toHaveLength(selectedCase.expected);
      }),
    );
  }

  it("rechecks the same primary object after a same-length provider edit and removal", () => {
    const selectedCase = cases.find(
      (entry) => entry.name === "canonical-one-relative-readonly-const-provider",
    );
    if (!selectedCase) throw new Error("Missing synthetic provider case");
    withCase(selectedCase, (file, root) => {
      const providerPath = path.join(root, "server/client.js");
      const originalProvider = fs.readFileSync(providerPath, "utf8");
      fs.utimesSync(
        providerPath,
        SHOPIFY_PROVIDER_TEST_MTIME_SECONDS,
        SHOPIFY_PROVIDER_TEST_MTIME_SECONDS,
      );
      const originalStat = fs.statSync(providerPath);
      expect(webhookSignatureRisk.scan?.(file)).toHaveLength(0);
      fs.writeFileSync(providerPath, originalProvider.replace("shopifyApi({", "forgedApi_({"));
      fs.utimesSync(providerPath, originalStat.atime, originalStat.mtime);
      expect(fs.statSync(providerPath).size).toBe(originalStat.size);
      expect(fs.statSync(providerPath).mtimeMs).toBe(originalStat.mtimeMs);
      expect(webhookSignatureRisk.scan?.(file)).toHaveLength(1);
      fs.writeFileSync(providerPath, originalProvider);
      expect(webhookSignatureRisk.scan?.(file)).toHaveLength(0);
      fs.unlinkSync(providerPath);
      expect(webhookSignatureRisk.scan?.(file)).toHaveLength(1);
    });
  });

  it("declines a symlinked sidecar and an unparseable sidecar", () => {
    const selectedCase = cases.find(
      (entry) => entry.name === "canonical-one-relative-readonly-const-provider",
    );
    if (!selectedCase) throw new Error("Missing synthetic provider case");
    withCase(selectedCase, (file, root) => {
      const providerPath = path.join(root, "server/client.js");
      fs.writeFileSync(providerPath, "export default (");
      expect(webhookSignatureRisk.scan?.(file)).toHaveLength(1);
      fs.unlinkSync(providerPath);
      const destination = path.join(root, "provider-source.js");
      fs.writeFileSync(destination, selectedCase.files["server/client.js"] ?? "");
      fs.symlinkSync(destination, providerPath);
      expect(webhookSignatureRisk.scan?.(file)).toHaveLength(1);
    });
  });
});
