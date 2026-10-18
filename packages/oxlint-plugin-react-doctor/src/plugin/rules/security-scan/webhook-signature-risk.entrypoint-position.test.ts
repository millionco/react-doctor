import { describe, expect, it, vi } from "vite-plus/test";
import * as sourceParser from "../../utils/parse-source-file.js";
import { CROSS_FILE_PARSE_MAX_BYTES } from "../../constants/thresholds.js";
import { webhookSignatureRisk } from "./webhook-signature-risk.js";

const cases = [
  {
    name: "legacy-proposal-double-quoted-prose-only",
    code: 'export const makeSource = () => "const payload = req.body;";\nconsole.error("Error writing to webhookHandler output:");\n',
    options: {
      relativePath: "src/generation/webhook-double-quoted-prose-only.js",
      absolutePath: "/src/generation/webhook-double-quoted-prose-only.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 2,
        column: 33,
      },
    ],
  },
  {
    name: "legacy-proposal-single-quoted-prose-only",
    code: "export const makeSource = () => \"const payload = req.body;\";\nconsole.error('Could not write webhookRoute output');\n",
    options: {
      relativePath: "src/generation/webhook-single-quoted-prose-only.js",
      absolutePath: "/src/generation/webhook-single-quoted-prose-only.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 2,
        column: 32,
      },
    ],
  },
  {
    name: "legacy-proposal-template-quasi-prose-only",
    code: 'export const makeSource = () => "const payload = req.body;";\nconsole.error(`Could not write webhookHandler output`);\n',
    options: {
      relativePath: "src/generation/webhook-template-quasi-prose-only.js",
      absolutePath: "/src/generation/webhook-template-quasi-prose-only.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 2,
        column: 32,
      },
    ],
  },
  {
    name: "legacy-proposal-generator-nested-template",
    code: 'export const makeSource = (name) => `const req = input; await ${name}(req.body);`;\nconsole.error("Error writing to webhookHandler output:");\n',
    options: {
      relativePath: "src/generation/webhook-generator-nested-template.js",
      absolutePath: "/src/generation/webhook-generator-nested-template.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 2,
        column: 33,
      },
    ],
  },
  {
    name: "legacy-proposal-literal-mixed-with-actual-post",
    code: 'console.error("Error writing to webhookHandler output:");\nexport async function POST(request) { return request.body; }\n',
    options: {
      relativePath: "src/generation/webhook-literal-mixed-with-actual-post.js",
      absolutePath: "/src/generation/webhook-literal-mixed-with-actual-post.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 2,
        column: 1,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 33,
      },
    ],
  },
  {
    name: "legacy-proposal-actual-before-prose",
    code: 'export async function POST(request) { return request.body; }\nconsole.error("Error writing to webhookHandler output:");\n',
    options: {
      relativePath: "src/generation/webhook-actual-before-prose.js",
      absolutePath: "/src/generation/webhook-actual-before-prose.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 1,
        column: 1,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 1,
      },
    ],
  },
  {
    name: "legacy-proposal-template-interpolation-actual-reference",
    code: "const output = `rendered ${webhookHandler(req)}`;\n",
    options: {
      relativePath: "src/generation/webhook-template-interpolation-actual-reference.js",
      absolutePath: "/src/generation/webhook-template-interpolation-actual-reference.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 1,
        column: 28,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 28,
      },
    ],
  },
  {
    name: "legacy-proposal-nested-interpolation-actual-reference",
    code: "const output = `outer ${`inner ${webhookHandler(req)}`}`;\n",
    options: {
      relativePath: "src/generation/webhook-nested-interpolation-actual-reference.js",
      absolutePath: "/src/generation/webhook-nested-interpolation-actual-reference.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 1,
        column: 34,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 34,
      },
    ],
  },
  {
    name: "legacy-proposal-escaped-interpolation-is-text",
    code: "const output = `generated \\${webhookHandler(req)} output`;\n",
    options: {
      relativePath: "src/generation/webhook-escaped-interpolation-is-text.js",
      absolutePath: "/src/generation/webhook-escaped-interpolation-is-text.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 30,
      },
    ],
  },
  {
    name: "legacy-proposal-escaped-quote-prose",
    code: 'const output = "escaped \\" webhookHandler payload req";\n',
    options: {
      relativePath: "src/generation/webhook-escaped-quote-prose.js",
      absolutePath: "/src/generation/webhook-escaped-quote-prose.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 1,
        column: 28,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 28,
      },
    ],
  },
  {
    name: "legacy-proposal-quoted-header-suppression-preserved",
    code: 'export const webhookHandler = (req) => req.headers["x-signature"];\n',
    options: {
      relativePath: "src/generation/webhook-quoted-header-suppression-preserved.js",
      absolutePath: "/src/generation/webhook-quoted-header-suppression-preserved.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [],
  },
  {
    name: "legacy-proposal-helper-name-veto-preserved",
    code: "export const webhookHandler = (req) => { verifySignature(req); return req.body; };\n",
    options: {
      relativePath: "src/generation/webhook-helper-name-veto-preserved.js",
      absolutePath: "/src/generation/webhook-helper-name-veto-preserved.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [],
  },
  {
    name: "legacy-proposal-actual-with-request-only-string",
    code: 'export const webhookHandler = () => "request data is a generated note";\n',
    options: {
      relativePath: "src/generation/webhook-actual-with-request-only-string.js",
      absolutePath: "/src/generation/webhook-actual-with-request-only-string.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 1,
        column: 14,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 14,
      },
    ],
  },
  {
    name: "legacy-proposal-single-token-string-boundary",
    code: 'const output = "webhookHandler"; const label = "req";\n',
    options: {
      relativePath: "src/generation/webhook-single-token-string-boundary.js",
      absolutePath: "/src/generation/webhook-single-token-string-boundary.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 1,
        column: 17,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 17,
      },
    ],
  },
  {
    name: "legacy-proposal-type-name-boundary",
    code: 'interface webhookHandler {}\nconst text = "req";\n',
    options: {
      relativePath: "src/generation/webhook-type-name.ts",
      absolutePath: "/src/generation/webhook-type-name.ts",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 1,
        column: 11,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 11,
      },
    ],
  },
  {
    name: "legacy-proposal-literal-reference-no-prose",
    code: 'const entrypoint = "webhookRoute"; const label = "req";\n',
    options: {
      relativePath: "src/generation/webhook-literal-reference-no-prose.js",
      absolutePath: "/src/generation/webhook-literal-reference-no-prose.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 1,
        column: 21,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 21,
      },
    ],
  },
  {
    name: "legacy-proposal-line-comment-fake-actual",
    code: '// export async function POST(request) { return request.body; }\nexport const makeSource = () => "const payload = req.body;";\nconsole.error("Error writing to webhookHandler output:");\n',
    options: {
      relativePath: "src/generation/webhook-line-comment-fake-actual.js",
      absolutePath: "/src/generation/webhook-line-comment-fake-actual.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 3,
        column: 33,
      },
    ],
  },
  {
    name: "legacy-proposal-block-comment-fake-actual",
    code: '/* webhookHandler(req) */\nexport const makeSource = () => "const payload = req.body;";\nconsole.error("Error writing to webhookHandler output:");\n',
    options: {
      relativePath: "src/generation/webhook-block-comment-fake-actual.js",
      absolutePath: "/src/generation/webhook-block-comment-fake-actual.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 3,
        column: 33,
      },
    ],
  },
  {
    name: "legacy-proposal-division-next-to-real-entrypoint",
    code: "const \u5408\u8a08 = 8 / 2;\nexport const webhookHandler = (req) => req.body / \u5408\u8a08;\n",
    options: {
      relativePath: "src/generation/webhook-division-next-to-real-entrypoint.js",
      absolutePath: "/src/generation/webhook-division-next-to-real-entrypoint.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 2,
        column: 14,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 2,
        column: 14,
      },
    ],
  },
  {
    name: "legacy-proposal-regexp-body-then-real-entrypoint",
    code: "const words = /webhookHandler req/;\nexport const webhookHandler = (req) => req.body;\n",
    options: {
      relativePath: "src/generation/webhook-regexp-body-then-real-entrypoint.js",
      absolutePath: "/src/generation/webhook-regexp-body-then-real-entrypoint.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [
      {
        line: 2,
        column: 14,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 16,
      },
    ],
  },
  {
    name: "legacy-proposal-tagged-template-boundary",
    code: "const code = compile`webhookHandler req`;\n",
    options: {
      relativePath: "src/generation/webhook-tagged-template-boundary.js",
      absolutePath: "/src/generation/webhook-tagged-template-boundary.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 22,
      },
    ],
  },
  {
    name: "legacy-proposal-opaque-generated-text-transport",
    code: 'const code = "export const webhookHandler = req => req.body";\nconsumeGeneratedSource(code);\n',
    options: {
      relativePath: "src/generation/webhook-opaque-generated-text-transport.js",
      absolutePath: "/src/generation/webhook-opaque-generated-text-transport.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 28,
      },
    ],
  },
  {
    name: "legacy-proposal-same-code-different-production-path",
    code: 'export const makeSource = () => "const payload = req.body;";\nconsole.error("Error writing to webhookHandler output:");\n',
    options: {
      relativePath: "src/runtime/webhook-routes.js",
      absolutePath: "/src/runtime/webhook-routes.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 2,
        column: 33,
      },
    ],
  },
  {
    name: "legacy-proposal-generated-file-metadata-boundary",
    code: 'export const makeSource = () => "const payload = req.body;";\nconsole.error("Error writing to webhookHandler output:");\n',
    options: {
      relativePath: "src/generation/webhook-generated-file-metadata-boundary.js",
      absolutePath: "/src/generation/webhook-generated-file-metadata-boundary.js",
      isGeneratedBundle: false,
      execution: "scan",
      reactProfileNotConsultedByDirectScan: true,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 2,
        column: 33,
      },
    ],
  },
  {
    name: "ast-position-contextual-of-division",
    code: "const req={};const of=8;const output=of / webhookHandler(req) /2;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-00.js",
      relativePath: "src/webhooks/case-00.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 43,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 43,
      },
    ],
  },
  {
    name: "ast-position-spaced-property-keyword",
    code: "const req={};const object={return:8};const output=object. return / webhookHandler(req) /2;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-01.js",
      relativePath: "src/webhooks/case-01.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 68,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 68,
      },
    ],
  },
  {
    name: "ast-position-repeated-ts-nonnull",
    code: "const req={};declare const value:number;const output=value!! / webhookHandler(req) /2;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-02.ts",
      relativePath: "src/webhooks/case-02.ts",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 64,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 64,
      },
    ],
  },
  {
    name: "ast-position-astral-division-unchanged",
    code: "const req={};const \ud801\udc00=8;const output=\ud801\udc00 / webhookHandler(req) /2;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-03.js",
      relativePath: "src/webhooks/case-03.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 43,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 43,
      },
    ],
  },
  {
    name: "ast-position-escaped-identifier-keyword-suffix",
    code: "const req={};const \\u{10400}return=8;const output=\\u{10400}return / webhookHandler(req) /2;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-04.js",
      relativePath: "src/webhooks/case-04.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 69,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 69,
      },
    ],
  },
  {
    name: "ast-position-prose-only",
    code: 'const req={};console.error("Error writing webhookHandler file",req);\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-05.js",
      relativePath: "src/webhooks/case-05.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 43,
      },
    ],
  },
  {
    name: "ast-position-prose-before-real",
    code: 'const req={};console.error("webhookHandler prose");webhookHandler(req);\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-06.js",
      relativePath: "src/webhooks/case-06.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 52,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 29,
      },
    ],
  },
  {
    name: "ast-position-regex-before-real",
    code: "const req={};const pattern=/webhookHandler(req)/;webhookRoute(req);\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-07.js",
      relativePath: "src/webhooks/case-07.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 50,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 29,
      },
    ],
  },
  {
    name: "ast-position-comment-before-real",
    code: "const req={};/* webhookHandler prose */webhookRoute(req);\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-08.js",
      relativePath: "src/webhooks/case-08.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 40,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 40,
      },
    ],
  },
  {
    name: "ast-position-template-expression",
    code: "const req={};const output=`webhookHandler prose ${webhookRoute(req)}`;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-09.js",
      relativePath: "src/webhooks/case-09.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 51,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 28,
      },
    ],
  },
  {
    name: "ast-position-tagged-template-quasi",
    code: "const req={};const output=tag`webhookHandler prose`;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-10.js",
      relativePath: "src/webhooks/case-10.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 31,
      },
    ],
  },
  {
    name: "ast-position-single-token-literal",
    code: 'const req={};const kind="webhookHandler";\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-11.js",
      relativePath: "src/webhooks/case-11.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 26,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 26,
      },
    ],
  },
  {
    name: "ast-position-single-token-specifier",
    code: 'import "webhookHandler";const req={};\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-12.js",
      relativePath: "src/webhooks/case-12.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 9,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 9,
      },
    ],
  },
  {
    name: "ast-position-escaped-space-literal",
    code: 'const req={};const text="prefix\\ webhookHandler";\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-13.js",
      relativePath: "src/webhooks/case-13.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 34,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 34,
      },
    ],
  },
  {
    name: "ast-position-escaped-quote-literal",
    code: 'const req={};const text="prefix\\" webhookHandler prose";\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-14.js",
      relativePath: "src/webhooks/case-14.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 35,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 35,
      },
    ],
  },
  {
    name: "ast-position-type-alias-retention",
    code: "const req={};type webhookHandler = string;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-15.ts",
      relativePath: "src/webhooks/case-15.ts",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 19,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 19,
      },
    ],
  },
  {
    name: "ast-position-pruned-annotation-fallback",
    code: "const req={};declare const value:webhookHandler;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-16.ts",
      relativePath: "src/webhooks/case-16.ts",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 34,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 34,
      },
    ],
  },
  {
    name: "ast-position-pruned-return-fallback",
    code: "const req={};const read=():webhookHandler=>req;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-17.ts",
      relativePath: "src/webhooks/case-17.ts",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 28,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 28,
      },
    ],
  },
  {
    name: "ast-position-unknown-after-prose",
    code: 'const req={};console.error("webhookHandler prose");declare const value:webhookRoute;\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-18.ts",
      relativePath: "src/webhooks/case-18.ts",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 29,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 29,
      },
    ],
  },
  {
    name: "ast-position-export-post",
    code: "export async function POST(req){return req;}\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-19.js",
      relativePath: "src/webhooks/case-19.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 1,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 1,
      },
    ],
  },
  {
    name: "ast-position-export-const-handler",
    code: "export const handler=(req)=>req;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-20.js",
      relativePath: "src/webhooks/case-20.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 1,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 1,
      },
    ],
  },
  {
    name: "ast-position-export-comments",
    code: "export /* note */ const POST=(req)=>req;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-21.js",
      relativePath: "src/webhooks/case-21.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 1,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 1,
      },
    ],
  },
  {
    name: "ast-position-fake-export-prose",
    code: 'const req={};const text="export const POST prose";\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-22.js",
      relativePath: "src/webhooks/case-22.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 26,
      },
    ],
  },
  {
    name: "ast-position-parse-failure-preserve",
    code: 'const req={};const broken=;console.error("webhookHandler prose");\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-23.js",
      relativePath: "src/webhooks/case-23.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 43,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 43,
      },
    ],
  },
  {
    name: "ast-position-private-name-unknown",
    code: "const req={};class Store {#webhookHandler=1;read(){return this.#webhookHandler;}}\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-24.js",
      relativePath: "src/webhooks/case-24.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 28,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 28,
      },
    ],
  },
  {
    name: "ast-position-crlf-code-location",
    code: 'const req={};\r\nconsole.error("webhookHandler prose");\r\nwebhookRoute(req);\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-25.js",
      relativePath: "src/webhooks/case-25.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 3,
        column: 1,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 2,
        column: 16,
      },
    ],
  },
  {
    name: "ast-position-unescaped-unicode-data-fallback",
    code: 'const req={};console.error("caf\u00e9 webhookHandler prose");\n',
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-26.js",
      relativePath: "src/webhooks/case-26.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 34,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 34,
      },
    ],
  },
  {
    name: "ast-position-single-token-template",
    code: "const req={};const text=`webhookHandler`;\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-27.js",
      relativePath: "src/webhooks/case-27.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 26,
      },
    ],
  },
  {
    name: "ast-position-regex-nested-character-class",
    code: "const req={};const pattern=/[webhookHandler/]/;webhookRoute(req);\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-28.js",
      relativePath: "src/webhooks/case-28.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 48,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 30,
      },
    ],
  },
  {
    name: "ast-position-member-property-identifier",
    code: "const req={};object.webhookHandler(req);\n",
    options: {
      absolutePath: "/private/react-doctor-synthetic/ast-entrypoint/src/webhooks/case-29.js",
      relativePath: "src/webhooks/case-29.js",
      isGeneratedBundle: false,
    },
    expectedLocations: [
      {
        line: 1,
        column: 21,
      },
    ],
    legacyFindings: [
      {
        message: "Webhook handler code does not show an obvious signature verification step.",
        line: 1,
        column: 21,
      },
    ],
  },
];

describe("AST classified entrypoint positions", () => {
  it.each(cases)("$name", ({ code, options, expectedLocations }) => {
    const findings = webhookSignatureRisk.scan?.({ ...options, content: code });
    expect(findings?.map(({ line, column }) => ({ line, column }))).toEqual(expectedLocations);
  });

  it("retains the complete legacy finding when parsing returns null", () => {
    const [scenario] = cases;
    if (!scenario) throw new Error("Missing synthetic scenario");
    const parser = vi.spyOn(sourceParser, "parseSourceText").mockReturnValueOnce(null);
    try {
      expect(webhookSignatureRisk.scan?.({ ...scenario.options, content: scenario.code })).toEqual(
        scenario.legacyFindings,
      );
      expect(parser).toHaveBeenCalledWith({
        filename: scenario.options.absolutePath,
        sourceText: scenario.code,
        shouldAttachParentReferences: false,
      });
    } finally {
      parser.mockRestore();
    }
  });

  it("retains the complete legacy finding when parsing throws", () => {
    const [scenario] = cases;
    if (!scenario) throw new Error("Missing synthetic scenario");
    const parser = vi.spyOn(sourceParser, "parseSourceText").mockImplementationOnce(() => {
      throw new Error("Parser unavailable");
    });
    try {
      expect(webhookSignatureRisk.scan?.({ ...scenario.options, content: scenario.code })).toEqual(
        scenario.legacyFindings,
      );
    } finally {
      parser.mockRestore();
    }
  });

  it("does not parse beyond the existing source byte budget", () => {
    const [scenario] = cases;
    if (!scenario) throw new Error("Missing synthetic scenario");
    const parser = vi.spyOn(sourceParser, "parseSourceText");
    try {
      expect(
        webhookSignatureRisk.scan?.({
          ...scenario.options,
          content: scenario.code + " ".repeat(CROSS_FILE_PARSE_MAX_BYTES),
        }),
      ).toEqual(scenario.legacyFindings);
      expect(parser).not.toHaveBeenCalled();
    } finally {
      parser.mockRestore();
    }
  });

  it("does not parse non ASCII source", () => {
    const scenario = cases.find(
      (entry) => entry.name === "legacy-proposal-division-next-to-real-entrypoint",
    );
    if (!scenario) throw new Error("Missing synthetic scenario");
    const parser = vi.spyOn(sourceParser, "parseSourceText");
    try {
      expect(webhookSignatureRisk.scan?.({ ...scenario.options, content: scenario.code })).toEqual(
        scenario.legacyFindings,
      );
      expect(parser).not.toHaveBeenCalled();
    } finally {
      parser.mockRestore();
    }
  });

  it("returns an old quiet gate without parsing", () => {
    const scenario = cases.find(
      (entry) => entry.name === "legacy-proposal-quoted-header-suppression-preserved",
    );
    if (!scenario) throw new Error("Missing synthetic scenario");
    const parser = vi.spyOn(sourceParser, "parseSourceText");
    try {
      expect(webhookSignatureRisk.scan?.({ ...scenario.options, content: scenario.code })).toEqual(
        scenario.legacyFindings,
      );
      expect(parser).not.toHaveBeenCalled();
    } finally {
      parser.mockRestore();
    }
  });

  it("retains the original whole array when a later match is unclassified", () => {
    const scenario = cases.find((entry) => entry.name === "ast-position-unknown-after-prose");
    if (!scenario) throw new Error("Missing synthetic scenario");
    expect(webhookSignatureRisk.scan?.({ ...scenario.options, content: scenario.code })).toEqual(
      scenario.legacyFindings,
    );
  });
});
