import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_REACT_DOCTOR_SCAN_RULE_IDS } from "../../packages/core/src/constants.js";
import {
  classifySecurityScanFile,
  REACT_DOCTOR_SCAN_RULES,
} from "../../packages/oxlint-plugin-react-doctor/src/core.js";
import { livenessFixtures } from "../../packages/oxlint-plugin-react-doctor/src/plugin/liveness/liveness-fixtures.js";

interface NativeScanBinding {
  readonly reactDoctorNativeScanRuleIds: () => unknown;
  readonly scanReactDoctorFile: (inputJson: string) => unknown;
  readonly scanReactDoctorFileSource: (
    absolutePath: string,
    relativePath: string,
    content: string,
    isGeneratedBundle: boolean,
    ruleIds: ReadonlyArray<string>,
  ) => unknown;
}

interface NativeModuleContainer {
  exports: unknown;
}

interface ScanParityFixture {
  readonly name: string;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly content: string;
  readonly isGeneratedBundle: boolean;
  readonly expectedRuleCounts?: Readonly<Record<string, number>>;
}

interface ScanParityFixtureInput {
  readonly name: string;
  readonly relativePath: string;
  readonly content: string;
  readonly isGeneratedBundle?: boolean;
  readonly expectedRuleCounts?: Readonly<Record<string, number>>;
}

const RETAINED_SCAN_RULE_IDS = [...NATIVE_REACT_DOCTOR_SCAN_RULE_IDS].sort();

const CORE_FIXTURE_DIRECTORIES = [
  "eva-mintlify-docs-platform",
  "ported-agent-database-safe-patterns",
  "ported-database-and-command-risks",
  "ported-static-matcher-patterns",
  "ported-static-matcher-safe-patterns",
  "real-supabase-public-read-private-write",
  "safe-hardened-app",
  "supabase-public-table-missing-rls",
  "supabase-rls-client-owned-authz",
];

const parityStripeSecret = ["sk", "live", "nativeParityCredentialValue"].join("_");
const parityAwsSecret = "N".repeat(40);
const parityPemBody = "A".repeat(39);
const parityJwt = [`eyJ${"a".repeat(8)}`, `eyJ${"b".repeat(8)}`, "c".repeat(16)].join(".");
const parityMixedMaskContent =
  'tool({ description: "Always fetch(endpoint)", execute: getValue });\ninitializeApp({ apiKey: "public", projectId: "sample" }); collection("users");\nconst secret = process.env.SESSION_SECRET || "embedded credential value";\n';
const parityCommentedArtifactContent =
  '// initializeApp({ apiKey: "public", projectId: "sample" }); collection("users");\n';

const REGRESSION_FIXTURE_INPUTS: ReadonlyArray<ScanParityFixtureInput> = [
  {
    name: "artifact-secret-leak-aws-bom-separators",
    relativePath: "public/settings.json",
    content: `🙂é AWS_SECRET_ACCESS_KEY\uFEFF=\uFEFF"${parityAwsSecret}"\n`,
    expectedRuleCounts: { "artifact-secret-leak": 1 },
  },
  {
    name: "artifact-secret-leak-aws-non-js-whitespace",
    relativePath: "public/settings.json",
    content: `AWS_SECRET_ACCESS_KEY\u0085=\u0085"${parityAwsSecret}"\n`,
    expectedRuleCounts: { "artifact-secret-leak": 0 },
  },
  {
    name: "artifact-secret-leak-private-key-bom-separators",
    relativePath: "public/settings.json",
    content: '🙂é "private_key"\uFEFF:\uFEFF"-----BEGIN PRIVATE KEY-----"\n',
    expectedRuleCounts: { "artifact-secret-leak": 1 },
  },
  {
    name: "artifact-secret-leak-private-key-non-js-whitespace-location",
    relativePath: "public/settings.json",
    content: '🙂é "private_key"\u0085:\u0085"-----BEGIN PRIVATE KEY-----"\n',
    expectedRuleCounts: { "artifact-secret-leak": 1 },
  },
  {
    name: "artifact-secret-leak-kelvin-key-lookalike",
    relativePath: "public/settings.json",
    content: `"Key-${"a".repeat(32)}"\n`,
    expectedRuleCounts: { "artifact-secret-leak": 0 },
  },
  {
    name: "artifact-secret-leak-long-s-role-lookalike",
    relativePath: "public/settings.json",
    content: '"ſervice_role"\n',
    expectedRuleCounts: { "artifact-secret-leak": 0 },
  },
  {
    name: "artifact-secret-leak-unicode-boundaries-location",
    relativePath: "public/settings.json",
    content: `{"value":"🙂é${parityStripeSecret}K"}\n`,
    expectedRuleCounts: { "artifact-secret-leak": 1 },
  },
  {
    name: "artifact-env-leak-unicode-boundaries-location",
    relativePath: "dist/assets/settings.js",
    content: 'export const value = "🙂éNEXT_PUBLIC_SESSION_SECRETK";\n',
    isGeneratedBundle: true,
    expectedRuleCounts: { "artifact-env-leak": 1 },
  },
  {
    name: "artifact-env-leak-long-s-name-lookalike",
    relativePath: "dist/assets/settings.js",
    content: 'export const value = "NEXT_PUBLIC_ſECRET";\n',
    isGeneratedBundle: true,
    expectedRuleCounts: { "artifact-env-leak": 0 },
  },
  {
    name: "artifact-env-leak-kelvin-name-lookalike",
    relativePath: "dist/assets/settings.js",
    content: 'export const value = "NEXT_PUBLIC_AWS_ACCESS_KEY";\n',
    isGeneratedBundle: true,
    expectedRuleCounts: { "artifact-env-leak": 0 },
  },
  {
    name: "artifact-env-leak-full-env-bom-location",
    relativePath: "dist/assets/settings.js",
    content: 'const marker = "🙂é"; const value = process\uFEFF.\uFEFFenv.DATABASE_URL;\n',
    isGeneratedBundle: true,
    expectedRuleCounts: { "artifact-env-leak": 1 },
  },
  {
    name: "package-metadata-jwt-unicode-boundaries-location",
    relativePath: "package.json",
    content: `{"description":"🙂é${parityJwt}K"}\n`,
    expectedRuleCounts: { "package-metadata-secret": 1 },
  },
  {
    name: "package-metadata-jwt-ascii-word-prefix",
    relativePath: "package.json",
    content: `{"description":"prefix${parityJwt}"}\n`,
    expectedRuleCounts: { "package-metadata-secret": 0 },
  },
  {
    name: "scan-content-independent-comment-and-string-masks",
    relativePath: "src/agents/tools/run.ts",
    content: parityMixedMaskContent,
    isGeneratedBundle: true,
    expectedRuleCounts: {
      "agent-tool-capability-risk": 0,
      "artifact-baas-authority-surface": 1,
      "secret-in-fallback": 1,
    },
  },
  {
    name: "scan-content-independent-comment-and-string-masks-json",
    relativePath: "src/agents/tools/run.json",
    content: parityMixedMaskContent,
    isGeneratedBundle: true,
    expectedRuleCounts: {
      "agent-tool-capability-risk": 0,
      "artifact-baas-authority-surface": 1,
    },
  },
  {
    name: "scan-content-comments-masked-in-typescript",
    relativePath: "public/config.ts",
    content: parityCommentedArtifactContent,
    isGeneratedBundle: true,
    expectedRuleCounts: { "artifact-baas-authority-surface": 0 },
  },
  {
    name: "scan-content-comments-retained-in-json",
    relativePath: "public/config.json",
    content: parityCommentedArtifactContent,
    isGeneratedBundle: true,
    expectedRuleCounts: { "artifact-baas-authority-surface": 1 },
  },
  {
    name: "agent-tool-capability-risk-positive",
    relativePath: "src/agents/tools/run.ts",
    content:
      'import { exec } from "node:child_process";\nexport const run = tool({ execute: ({ command }) => exec(command) });\n',
  },
  {
    name: "agent-tool-capability-risk-negative-description",
    relativePath: "src/agents/tools/read.ts",
    content:
      'export const read = tool({ description: "Always fetch the current value", execute: getValue });\n',
  },
  {
    name: "artifact-baas-authority-surface-positive",
    relativePath: "dist/assets/app.js",
    content:
      'initializeApp({ apiKey: "public", projectId: "demo" }); collection("users"); const user = { isAdmin: true };\n',
    isGeneratedBundle: true,
  },
  {
    name: "artifact-baas-authority-surface-negative-path",
    relativePath: "src/server/firebase.ts",
    content:
      'initializeApp({ apiKey: "public", projectId: "demo" }); collection("users"); const user = { isAdmin: true };\n',
  },
  {
    name: "artifact-env-leak-positive",
    relativePath: "dist/assets/env.js",
    content: 'export const name = "NEXT_PUBLIC_SERVICE_ROLE_SECRET";\n',
    isGeneratedBundle: true,
  },
  {
    name: "artifact-env-leak-negative-public-name",
    relativePath: "dist/assets/env.js",
    content: 'export const name = "VITE_STYTCH_PUBLIC_TOKEN";\n',
    isGeneratedBundle: true,
  },
  {
    name: "artifact-secret-leak-positive",
    relativePath: "dist/assets/billing.js",
    content: `export const key = "${parityStripeSecret}";\n`,
    isGeneratedBundle: true,
  },
  {
    name: "artifact-secret-leak-negative-path",
    relativePath: "src/server/billing.ts",
    content: `export const key = "${parityStripeSecret}";\n`,
  },
  {
    name: "build-pipeline-secret-boundary-positive",
    relativePath: ".github/workflows/release.yml",
    content: "steps:\n  - run: pnpm install\n    env:\n      TOKEN: ${{ secrets.RELEASE_TOKEN }}\n",
  },
  {
    name: "build-pipeline-secret-boundary-negative-step-scope",
    relativePath: ".github/workflows/release.yml",
    content:
      "steps:\n  - run: pnpm install\n  - run: pnpm publish\n    env:\n      TOKEN: ${{ secrets.RELEASE_TOKEN }}\n",
  },
  {
    name: "clickjacking-redirect-risk-positive",
    relativePath: "src/redirect.ts",
    content: "export const GET = () => redirect(next);\n",
  },
  {
    name: "clickjacking-redirect-risk-negative-sanitized",
    relativePath: "src/redirect.ts",
    content: "export const GET = () => redirect(validateSafeRedirect(next));\n",
  },
  {
    name: "command-execution-input-risk-positive",
    relativePath: "src/server/convert.ts",
    content: 'exec("convert " + req.body.filename);\n',
  },
  {
    name: "command-execution-input-risk-negative-argv",
    relativePath: "src/server/git.ts",
    content: 'spawn("git", ["log", req.query.branch]);\n',
  },
  {
    name: "cors-cookie-trust-risk-positive",
    relativePath: "src/server/cors.ts",
    content:
      'headers["Access-Control-Allow-Credentials"] = "true";\nheaders["Access-Control-Allow-Origin"] = "*";\n',
  },
  {
    name: "cors-cookie-trust-risk-negative",
    relativePath: "src/server/cors.ts",
    content: 'headers["Access-Control-Allow-Origin"] = "*";\n',
  },
  {
    name: "firebase-client-owned-authz-field-positive",
    relativePath: "src/features/create.ts",
    content: 'addDoc(collection(db, "projects"), { ownerId: user.id });\n',
  },
  {
    name: "firebase-client-owned-authz-field-negative-server-path",
    relativePath: "src/server/create.ts",
    content: 'addDoc(collection(db, "projects"), { ownerId: user.id });\n',
  },
  {
    name: "firebase-permissive-rules-positive",
    relativePath: "firestore.rules",
    content: "match /users/{uid} {\n  allow read, write: if true;\n}\n",
  },
  {
    name: "firebase-permissive-rules-negative-comment",
    relativePath: "firestore.rules",
    content: "// allow read, write: if true;\n",
  },
  {
    name: "firebase-query-filter-as-auth-positive",
    relativePath: "src/hooks/documents.ts",
    content: 'db.collection("documents").where("uid", "==", user.uid);\n',
  },
  {
    name: "firebase-query-filter-as-auth-negative-server-path",
    relativePath: "src/server/documents.ts",
    content: 'db.collection("documents").where("uid", "==", user.uid);\n',
  },
  {
    name: "git-provider-url-injection-risk-positive",
    relativePath: "src/server/repos.ts",
    content: "export const url = `https://api.github.com/repos/${req.query.owner}/repo`;\n",
  },
  {
    name: "git-provider-url-injection-risk-negative-encoded",
    relativePath: "src/server/repos.ts",
    content:
      "export const url = `https://api.github.com/repos/${encodeURIComponent(req.query.owner)}/repo`;\n",
  },
  {
    name: "import-metadata-execution-risk-positive",
    relativePath: "src/server/import.ts",
    content: 'import { exec } from "node:child_process";\nexec(`unzip ${uploadPath}`);\n',
  },
  {
    name: "import-metadata-execution-risk-negative-static",
    relativePath: "src/server/import.ts",
    content: 'import { exec } from "node:child_process";\nexec("unzip fixture.zip");\n',
  },
  {
    name: "insecure-crypto-risk-positive",
    relativePath: "src/server/auth.ts",
    content: 'export const digest = createHash("md5").update(password);\n',
  },
  {
    name: "insecure-crypto-risk-negative-fingerprint",
    relativePath: "src/files.ts",
    content: 'export const fingerprint = createHash("md5").update(file);\n',
  },
  ...[
    "requestSignature === expected",
    "expected !== requestSignature",
    "requestSIGNATURE === expectedSignature",
    "expectedSignature === requestSIGNATURE",
    "requestSignature() === expected()",
    "expected() !== requestSignature()",
    `requestSignature(${"input,".repeat(300)}\nvalue) === expected`,
    `expected(${"input,".repeat(300)}\nvalue) !== requestSignature`,
    "requestSignature\uFEFF===\u00A0expected",
    "KrequestSignature === expected",
    "ſrequestSignature === expected",
    "requestSignature.length === input; requestSignature === expected",
    ...[100, 101, 102].map((length) => `${"a".repeat(length)}Signature === expected`),
  ].map((comparison, index) => ({
    name: `insecure-crypto-risk-signature-comparison-${index}`,
    relativePath: "src/server/signature.ts",
    content: `const crypto = require("crypto");\nconst valid = ${comparison};\n`,
    expectedRuleCounts: { "insecure-crypto-risk": 1 },
  })),
  ...[
    "signature === expected",
    "expected === signature",
    "requestSignatureType === input; requestSignature === expected",
    "requestSignature === true; requestSignature === expected",
    "requestSignature === expected.length; requestSignature === expected",
    "requestſignature === expected",
  ].map((comparison, index) => ({
    name: `insecure-crypto-risk-first-signature-suppression-${index}`,
    relativePath: "src/server/signature.ts",
    content: `const crypto = require("crypto");\nconst valid = ${comparison};\n`,
    expectedRuleCounts: { "insecure-crypto-risk": 0 },
  })),
  {
    name: "source-input-escaped-unicode-and-nul",
    relativePath: "src/server/máth-🙂.ts",
    content: '/* 🙂e\u0301\uFEFF\0 */\r\nconst token = createHash("md5").update(password);\r\n',
    expectedRuleCounts: { "insecure-crypto-risk": 1 },
  },
  ...["é", "中", "\u0301", "🙂"].flatMap((boundary) => [
    {
      name: `insecure-crypto-risk-unicode-word-boundary-${boundary}`,
      relativePath: "src/server/auth.ts",
      content: `const ${boundary}token${boundary} = ${boundary}md5(password);\n`,
      expectedRuleCounts: { "insecure-crypto-risk": 1 },
    },
    {
      name: `insecure-crypto-risk-unicode-protocol-path-${boundary}`,
      relativePath: `src/${boundary}_id${boundary}/auth.ts`,
      content: 'const token = createHash("md5").update(password);\n',
      expectedRuleCounts: { "insecure-crypto-risk": 0 },
    },
    {
      name: `insecure-crypto-risk-unicode-protocol-context-${boundary}`,
      relativePath: "src/server/auth.ts",
      content: `const token = md5(password); const ${boundary}etag${boundary} = value;\n`,
      expectedRuleCounts: { "insecure-crypto-risk": 0 },
    },
  ]),
  ...["\uFEFF", "\u00A0", "\u0085"].map((whitespace) => ({
    name: `insecure-crypto-risk-cipher-whitespace-${whitespace.codePointAt(0)}`,
    relativePath: "src/server/auth.ts",
    content: `const value = createCipheriv${whitespace}("des", key, iv);\n`,
    expectedRuleCounts: { "insecure-crypto-risk": whitespace === "\u0085" ? 0 : 1 },
  })),
  {
    name: "insecure-crypto-risk-ascii-word-adjacency",
    relativePath: "src/server/auth.ts",
    content: "const token = _md5(password); const secret = amd5(password);\n",
    expectedRuleCounts: { "insecure-crypto-risk": 0 },
  },
  {
    name: "insecure-crypto-risk-unicode-cipher-name",
    relativePath: "src/server/auth.ts",
    content: 'const crypto = "🙂DES中";\n',
    expectedRuleCounts: { "insecure-crypto-risk": 1 },
  },
  {
    name: "insecure-crypto-risk-unicode-boolean-comparand",
    relativePath: "src/server/auth.ts",
    content: "const crypto = require('crypto'); const valid = requestSignature === true中;\n",
    expectedRuleCounts: { "insecure-crypto-risk": 0 },
  },
  {
    name: "insecure-crypto-risk-unicode-signature-metadata",
    relativePath: "src/server/auth.ts",
    content: "const crypto = require('crypto'); const valid = requestSignatureType中 === input;\n",
    expectedRuleCounts: { "insecure-crypto-risk": 0 },
  },
  {
    name: "insecure-session-cookie-positive",
    relativePath: "src/server/session.ts",
    content: 'res.cookie("session", token, { httpOnly: false });\n',
  },
  {
    name: "insecure-session-cookie-negative-http-only",
    relativePath: "src/server/session.ts",
    content: 'res.cookie("session", token, { httpOnly: true });\n',
  },
  {
    name: "jwt-insecure-verification-positive",
    relativePath: "src/server/jwt.ts",
    content: 'jwt.verify(token, key, { algorithms: ["none"] });\n',
  },
  {
    name: "jwt-insecure-verification-negative-string",
    relativePath: "src/server/jwt.ts",
    content: 'throw new Error("Never use algorithms: [\\"none\\"] for jwt");\n',
  },
  {
    name: "key-lifecycle-risk-positive",
    relativePath: "config/deploy.pem",
    content:
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7c1QpDK0N77BSO0FbGCPzcgMCS8ssCXd2eicCRb45fJsbiCe\n-----END RSA PRIVATE KEY-----\n",
  },
  ...[
    "\t",
    "\v",
    "\f",
    " ",
    "\n",
    "\r",
    "\u00A0",
    "\u1680",
    "\u2000",
    "\u2001",
    "\u2002",
    "\u2003",
    "\u2004",
    "\u2005",
    "\u2006",
    "\u2007",
    "\u2008",
    "\u2009",
    "\u200A",
    "\u2028",
    "\u2029",
    "\u202F",
    "\u205F",
    "\u3000",
    "\uFEFF",
  ].flatMap((whitespace) => [
    {
      name: `key-lifecycle-risk-pem-body-whitespace-${whitespace.codePointAt(0)}`,
      relativePath: "config/deploy.pem",
      content: `🙂é\n-----BEGIN PRIVATE KEY-----\n${"A".repeat(20)}${whitespace}${"B".repeat(18)}-----END PRIVATE KEY-----`,
      expectedRuleCounts: { "key-lifecycle-risk": 1 },
    },
    {
      name: `key-lifecycle-risk-pem-start-whitespace-${whitespace.codePointAt(0)}`,
      relativePath: "config/deploy.pem",
      content: `🙂é\n-----BEGIN PRIVATE KEY-----${whitespace}${parityPemBody}-----END PRIVATE KEY-----`,
      expectedRuleCounts: { "key-lifecycle-risk": 1 },
    },
  ]),
  {
    name: "key-lifecycle-risk-pem-body-non-js-whitespace",
    relativePath: "config/deploy.pem",
    content: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(20)}\u0085${"B".repeat(18)}-----END PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 0 },
  },
  {
    name: "key-lifecycle-risk-pem-start-non-js-whitespace",
    relativePath: "config/deploy.pem",
    content: `-----BEGIN PRIVATE KEY-----\u0085${parityPemBody}-----END PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 0 },
  },
  {
    name: "key-lifecycle-risk-pem-lowercase-header",
    relativePath: "config/deploy.pem",
    content: `-----begin rsa private key-----\n${parityPemBody}-----end rsa private key-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 1 },
  },
  {
    name: "key-lifecycle-risk-pem-mixed-case-header",
    relativePath: "config/deploy.pem",
    content: `-----bEgIn OpEnSsH pRiVaTe KeY-----\\r\\n\uFEFF${parityPemBody}-----END OPENSSH PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 1 },
  },
  {
    name: "key-lifecycle-risk-pem-uppercase-escaped-spacing",
    relativePath: "config/deploy.pem",
    content: `-----BEGIN PRIVATE KEY-----\\R\\N${parityPemBody}-----END PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 1 },
  },
  ...["ts", "json"].flatMap((extension) => [
    {
      name: `key-lifecycle-risk-pem-block-comment-${extension}`,
      relativePath: `config/deploy.${extension}`,
      content: `/* 🙂é\u2028-----BEGIN PRIVATE KEY-----\n${parityPemBody}-----END PRIVATE KEY----- */`,
      expectedRuleCounts: { "key-lifecycle-risk": extension === "ts" ? 0 : 1 },
    },
    {
      name: `key-lifecycle-risk-pem-line-comment-${extension}`,
      relativePath: `config/deploy.${extension}`,
      content: `// -----BEGIN PRIVATE KEY----- ${parityPemBody}-----END PRIVATE KEY-----`,
      expectedRuleCounts: { "key-lifecycle-risk": extension === "ts" ? 0 : 1 },
    },
    {
      name: `key-lifecycle-risk-assignment-comment-${extension}`,
      relativePath: `config/deploy.${extension}`,
      content: '/* SIGNING_KEY = "embedded credential value"; */',
      expectedRuleCounts: { "key-lifecycle-risk": extension === "ts" ? 0 : 1 },
    },
  ]),
  {
    name: "key-lifecycle-risk-pem-after-unicode-comment",
    relativePath: "config/deploy.ts",
    content: `/* 🙂é\u2028 note */\nconst key = "-----BEGIN PRIVATE KEY----- ${parityPemBody}-----END PRIVATE KEY-----";`,
    expectedRuleCounts: { "key-lifecycle-risk": 1 },
  },
  {
    name: "key-lifecycle-risk-pem-placeholder-window",
    relativePath: "config/deploy.pem",
    content: `SaMpLe${" ".repeat(40)}-----BEGIN PRIVATE KEY-----\n${parityPemBody}-----END PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 0 },
  },
  {
    name: "key-lifecycle-risk-pem-outside-placeholder-window",
    relativePath: "config/deploy.pem",
    content: `SaMpLe${" ".repeat(41)}-----BEGIN PRIVATE KEY-----\n${parityPemBody}-----END PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 1 },
  },
  {
    name: "key-lifecycle-risk-pem-ellipsis-placeholder",
    relativePath: "config/deploy.pem",
    content: `-----BEGIN PRIVATE KEY-----\n${parityPemBody}...-----END PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 0 },
  },
  {
    name: "key-lifecycle-risk-pem-ellipsis-backtracking-below-threshold",
    relativePath: "config/deploy.pem",
    content: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(199)}...-----END PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 0 },
  },
  {
    name: "key-lifecycle-risk-pem-ellipsis-backtracking-at-threshold",
    relativePath: "config/deploy.pem",
    content: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(200)}...-----END PRIVATE KEY-----`,
    expectedRuleCounts: { "key-lifecycle-risk": 1 },
  },
  {
    name: "key-lifecycle-risk-negative-documentation",
    relativePath: "README.md",
    content:
      "-----BEGIN PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7c1QpDK0N77BSO0FbGCPzcgMCS8ssCXd2eicCRb45fJsbiCe\n-----END PRIVATE KEY-----\n",
  },
  {
    name: "agent-tool-capability-risk-positive-ascii-boundary",
    relativePath: "src/agents/tools/run.ts",
    content: "étool({ execute: () => fetch(endpoint) });\n",
  },
  {
    name: "artifact-env-leak-positive-html-marker-string",
    relativePath: "dist/assets/env.js",
    content: 'const marker = "<!--"; const databaseUrl = process.env.DATABASE_URL;\n',
    isGeneratedBundle: true,
  },
  {
    name: "artifact-secret-leak-positive-localhost-lookalike",
    relativePath: "dist/assets/config.js",
    content: 'const url = "postgres://native:strongCredential@localhost.evil.example/app";\n',
    isGeneratedBundle: true,
  },
  {
    name: "artifact-secret-leak-positive-localhost-control-lookalike",
    relativePath: "dist/assets/config.js",
    content: 'const url = "postgres://native:strongCredential@localhost\u001c.evil.example/app";\n',
    isGeneratedBundle: true,
  },
  {
    name: "build-pipeline-secret-boundary-positive-commented-steps-key",
    relativePath: ".github/workflows/install.yml",
    content:
      'steps:  # dependency install\n  - run: "🙂 pnpm install"\n    env:\n      TOKEN: ${{ secrets.INSTALL_TOKEN }}\n',
  },
  {
    name: "clickjacking-redirect-risk-negative-safe-prefix",
    relativePath: "src/redirect.ts",
    content: "export const GET = () => redirect(safeRedirect(next));\n",
  },
  {
    name: "command-execution-input-risk-positive-pattern-priority",
    relativePath: "src/server/commands.ts",
    content: "spawn(request.command);\nexec(req.body.command);\n",
  },
  {
    name: "cors-cookie-trust-risk-positive-source-order",
    relativePath: "src/server/cors.ts",
    content:
      'const cookie = "session=value; Domain=.example.com";\nheaders["Access-Control-Allow-Credentials"] = "true";\nheaders["Access-Control-Allow-Origin"] = "*";\n',
  },
  {
    name: "import-metadata-execution-risk-negative-single-token-literal",
    relativePath: "src/server/import.ts",
    content: 'import { exec } from "node:child_process";\nexec("metadata");\n',
  },
  {
    name: "insecure-crypto-risk-positive-single-letter-call",
    relativePath: "src/server/signature.ts",
    content: 'import crypto from "node:crypto";\nif (computedSignature === X()) reject();\n',
  },
  {
    name: "key-lifecycle-risk-positive-utf16-column",
    relativePath: "config/deploy.pem",
    content:
      "🙂-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7c1QpDK0N77BSO0FbGCPzcgMCS8ssCXd2eicCRb45fJsbiCe\n-----END RSA PRIVATE KEY-----\n",
  },
  {
    name: "agent-tool-capability-risk-positive-multibyte-escape",
    relativePath: "src/agents/tools/run.ts",
    content: String.raw`const note = "\🙂"; tool({ execute: () => fetch(endpoint) });`,
  },
  {
    name: "insecure-session-cookie-positive-multibyte-escape",
    relativePath: "src/server/session.ts",
    content: String.raw`res.cookie("session", token, { note: "\🙂", httpOnly: false });`,
  },
  {
    name: "jwt-insecure-verification-positive-multibyte-escape",
    relativePath: "src/server/jwt.ts",
    content: String.raw`const note = "\🙂"; jwt.verify(token, key, { algorithms: ["none"] });`,
  },
  {
    name: "mcp-tool-capability-risk-positive",
    relativePath: "src/mcp/tools.ts",
    content:
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nserver.tool("run", async ({ command }) => execSync(command));\n',
  },
  {
    name: "mcp-tool-capability-risk-negative-description",
    relativePath: "src/mcp/tools.ts",
    content:
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nserver.tool("list", { description: "Always fetch the current value" }, getValue);\n',
  },
  {
    name: "mdx-ssr-execution-risk-positive",
    relativePath: "src/app/docs/page.tsx",
    content:
      'import { compileMDX } from "next-mdx-remote/rsc";\nexport const page = () => compileMDX({ source: tenantDocumentSource });\n',
  },
  {
    name: "mdx-ssr-execution-risk-negative-owned-content",
    relativePath: "src/app/docs/page.tsx",
    content:
      'import { MDXRemote } from "next-mdx-remote/rsc";\nexport const Page = ({ children }) => <MDXRemote source={children} />;\n',
  },
  {
    name: "package-metadata-secret-positive",
    relativePath: "package.json",
    content: `{"name":"native-parity","config":{"key":"${parityStripeSecret}"}}\n`,
  },
  {
    name: "package-metadata-secret-negative-role-name",
    relativePath: "package.json",
    content: '{"name":"native-parity","description":"Utilities for the service_role role name"}\n',
  },
  {
    name: "package-metadata-secret-negative-lowercase-env-placeholder",
    relativePath: "package.json",
    content:
      '{"name":"native-parity","config":{"database":"postgres://user:$database_password@db.prod.example.com/app"}}\n',
  },
  {
    name: "path-traversal-risk-positive",
    relativePath: "src/server/files.ts",
    content: "export const read = (req) => path.join(UPLOADS, req.params.file);\n",
  },
  {
    name: "path-traversal-risk-negative-basename",
    relativePath: "src/server/files.ts",
    content: "export const read = (req) => path.join(UPLOADS, path.basename(req.params.file));\n",
  },
  {
    name: "path-traversal-risk-positive-non-javascript-whitespace",
    relativePath: "src/server/files.ts",
    content:
      "export const read = (req) => path.join(UPLOADS, path.basename(\u001creq.params.file));\n",
  },
  {
    name: "plugin-update-trust-risk-positive",
    relativePath: "Dockerfile",
    content: "RUN curl -fsSL https://example.com/installer.sh | sh\n",
  },
  {
    name: "plugin-update-trust-risk-negative-checksum",
    relativePath: "Dockerfile",
    content:
      'RUN wget https://example.com/tool.zip && echo "$EXPECTED_SHA tool.zip" | sha256sum -c -\n',
  },
  {
    name: "plugin-update-trust-risk-positive-exact-window-boundary",
    relativePath: "Dockerfile",
    content: `RUN installer ${"x".repeat(249)}.zip\n`,
  },
  {
    name: "plugin-update-trust-risk-negative-past-window-boundary",
    relativePath: "Dockerfile",
    content: `RUN installer ${"x".repeat(250)}.zip\n`,
  },
  {
    name: "plugin-update-trust-risk-positive-upload-lookalike-without-space",
    relativePath: "Dockerfile",
    content: "RUN curl-T native-plugin.zip\n",
  },
  {
    name: "plugin-update-trust-risk-negative-carriage-return-dot",
    relativePath: "Dockerfile",
    content: "RUN auto\rupdater native-plugin.zip\n",
  },
  {
    name: "postmessage-origin-risk-positive",
    relativePath: "src/widget.ts",
    content: 'window.addEventListener("message", (event) => {\n  handleCommand(event.data);\n});\n',
  },
  {
    name: "postmessage-origin-risk-negative-websocket",
    relativePath: "src/socket-client.ts",
    content: "socket.onmessage = (event) => {\n  handlePacket(event.data);\n};\n",
  },
  {
    name: "postmessage-origin-risk-positive-uppercase-extension",
    relativePath: "src/widget.TS",
    content: 'window.addEventListener("message", (event) => {\n  handleCommand(event.data);\n});\n',
  },
  {
    name: "postmessage-origin-risk-negative-constructor-bom-whitespace",
    relativePath: "src/widget.ts",
    content: "const es = new\uFEFFEventSource(url); es.onmessage = event => use(event.data);\n",
  },
  {
    name: "postmessage-origin-risk-negative-typed-receiver-bom-whitespace",
    relativePath: "src/widget.ts",
    content: "const connect = (w:\uFEFFWorker) => { w.onmessage = event => use(event.data); };\n",
  },
  {
    name: "postmessage-origin-risk-negative-local-binding-bom-whitespace",
    relativePath: "src/widget.ts",
    content:
      "window.onmessage = event => { const\uFEFFdata = event.data; if(event.origin) use(data); };\n",
  },
  {
    name: "postmessage-origin-risk-positive-unicode-source-lookalike",
    relativePath: "src/widget.ts",
    content:
      'window.addEventListener("message", (event) => {\n  if (event.ſource === window.parent) return;\n  handleCommand(event.data);\n});\n',
  },
  {
    name: "postmessage-origin-risk-mixed-nested-handler-order",
    relativePath: "src/widget.ts",
    content:
      'window.onmessage = event => { use(event.data); window.addEventListener("message", e => use(e.data)); };\nwindow.addEventListener("message", msg => use(msg.data));\n',
    expectedRuleCounts: { "postmessage-origin-risk": 3 },
  },
  {
    name: "postmessage-origin-risk-decorator-computed-key-and-wrapper",
    relativePath: "src/widget.ts",
    content:
      '@decorate(window.onmessage = event => use(event.data))\nclass Widget { [window.addEventListener("message", e => use(e.data))]() {} }\nconst setup = () => (window.onmessage = msg => use(msg.data)) satisfies unknown;\n',
    expectedRuleCounts: { "postmessage-origin-risk": 3 },
  },
  {
    name: "postmessage-origin-risk-invalid-source",
    relativePath: "src/widget.ts",
    content: "window.onmessage = event => { use(event.data);\n",
    expectedRuleCounts: { "postmessage-origin-risk": 0 },
  },
  ...["WebSocket", "SharedWorker", "Worker", "EventSource", "BroadcastChannel"].map(
    (constructorName) => ({
      name: `postmessage-origin-risk-short-receiver-${constructorName}`,
      relativePath: "src/widget.ts",
      content: `const c = new ${constructorName}(url); c.onmessage = event => use(event.data);\n`,
      expectedRuleCounts: { "postmessage-origin-risk": 0 },
    }),
  ),
  {
    name: "postmessage-origin-risk-short-typed-port",
    relativePath: "src/widget.ts",
    content:
      'const setup = (c: MessagePort) => c.addEventListener("message", event => use(event.data));\n',
    expectedRuleCounts: { "postmessage-origin-risk": 0 },
  },
  {
    name: "postmessage-origin-risk-original-is-not-origin",
    relativePath: "src/widget.ts",
    content:
      "window.onmessage = event => { check(original, ORIGINAL, originalValue); use(event.data); };\n",
    expectedRuleCounts: { "postmessage-origin-risk": 1 },
  },
  {
    name: "postmessage-origin-risk-original-before-origin-helper",
    relativePath: "src/widget.ts",
    content:
      "window.onmessage = event => { check(original); if (trustedOrigin(event)) use(event.data); };\n",
    expectedRuleCounts: { "postmessage-origin-risk": 0 },
  },
  {
    name: "postmessage-origin-risk-origin-after-use",
    relativePath: "src/widget.ts",
    content: "window.onmessage = event => { use(event.data); check(event.origin); };\n",
    expectedRuleCounts: { "postmessage-origin-risk": 1 },
  },
  {
    name: "public-debug-artifact-positive-secret-escalation",
    relativePath: "public/debug.log",
    content: `billing key: ${parityStripeSecret}\n`,
  },
  {
    name: "public-debug-artifact-negative-locale",
    relativePath: "public/locales/en/trace.json",
    content: '{"title":"Trace details"}\n',
  },
  {
    name: "public-env-secret-name-positive",
    relativePath: "src/client.ts",
    content: "export const databaseUrl = import.meta.env.VITE_DATABASE_URL;\n",
  },
  {
    name: "public-env-secret-name-negative-publishable",
    relativePath: "src/client.ts",
    content: "export const token = import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN;\n",
  },
  {
    name: "repository-secret-file-positive",
    relativePath: ".env.production",
    content: "DATABASE_URL=postgres://native:r7Qm2vL9pX4z@db.internal.example.com/app\n",
  },
  {
    name: "repository-secret-file-negative-template",
    relativePath: ".env.production.template",
    content: "DATABASE_URL=postgres://native:r7Qm2vL9pX4z@db.internal.example.com/app\n",
  },
  {
    name: "repository-secret-file-negative-uppercase-x-placeholder",
    relativePath: ".env.production",
    content: "DATABASE_URL=postgres://native:XXXXXXXX@db.internal.example.com/app\n",
  },
  {
    name: "request-body-mass-assignment-positive",
    relativePath: "src/server/users.ts",
    content: "await database.user.update({ data: { ...req.body } });\n",
  },
  {
    name: "request-body-mass-assignment-negative-allowlist",
    relativePath: "src/server/users.ts",
    content: "await database.user.update({ data: { ...allowlistedFields } });\n",
  },
  {
    name: "secret-in-fallback-positive",
    relativePath: "src/server/billing.ts",
    content: `export const key = process.env.STRIPE_SECRET_KEY ?? "${parityStripeSecret}";\n`,
  },
  {
    name: "secret-in-fallback-negative-numeric",
    relativePath: "src/server/session.ts",
    content: 'export const timeout = process.env.SESSION_TOKEN_TIMEOUT ?? "18000000";\n',
  },
  {
    name: "secret-in-fallback-negative-uppercase-name-placeholder",
    relativePath: "src/server/session.ts",
    content: 'export const token = process.env.CLIENT_SECRET ?? "CBOARD_CLIENT_TOKEN";\n',
  },
  {
    name: "svg-filter-clickjacking-risk-positive",
    relativePath: "src/payment-frame.tsx",
    content:
      'export const Payment = ({ src }) => <iframe src={src} style={{ filter: "url(#warp)" }} />;\n',
  },
  {
    name: "svg-filter-clickjacking-risk-negative-sibling",
    relativePath: "src/payment-frame.tsx",
    content:
      'export const Payment = ({ src }) => <><iframe src={src} /><img style={{ filter: "url(#shadow)" }} /></>;\n',
  },
  {
    name: "tenant-static-proxy-risk-positive",
    relativePath: "app/api/static/route.ts",
    content: "export const GET = () => fetch(`${CDN_BASE}/${tenant}/${assetPath}`);\n",
  },
  {
    name: "tenant-static-proxy-risk-negative-request-options",
    relativePath: "app/api/users/route.ts",
    content:
      'export const GET = ({ params }) => fetch("/api/users", { body: JSON.stringify(params) });\n',
  },
  {
    name: "tenant-static-proxy-risk-negative-organization-property",
    relativePath: "app/api/static/route.ts",
    content: "export const GET = () => fetch(`${url.organization}/x`);\n",
  },
  {
    name: "untrusted-redirect-following-positive",
    relativePath: "app/api/preview/route.ts",
    content:
      "export const POST = async (request) => {\n  const { imageUrl } = await request.json();\n  return fetch(imageUrl);\n};\n",
  },
  {
    name: "untrusted-redirect-following-negative-manual",
    relativePath: "app/api/preview/route.ts",
    content:
      'export const POST = async (request) => {\n  const { imageUrl } = await request.json();\n  return fetch(imageUrl, { redirect: "manual" });\n};\n',
  },
  {
    name: "untrusted-redirect-following-negative-unicode-whitespace-manual",
    relativePath: "app/api/preview/route.ts",
    content:
      'export const GET = (request) => fetch(request.nextUrl.searchParams.get("url"), { redirect\u00a0:\u00a0"manual" });\n',
  },
  {
    name: "url-prefilled-privileged-action-positive",
    relativePath: "src/app/invite/page.tsx",
    content: 'const invitedRole = searchParams.get("role");\n',
  },
  {
    name: "url-prefilled-privileged-action-negative-validator",
    relativePath: "src/app/invite/page.tsx",
    content: 'const invitedRole = parseRoleSearchParam(searchParams.get("role"));\n',
  },
  {
    name: "webhook-signature-risk-positive",
    relativePath: "app/api/webhook/route.ts",
    content:
      "export const POST = async (request) => {\n  const event = await request.json();\n  return Response.json(event);\n};\n",
  },
  {
    name: "webhook-signature-risk-negative-delegated",
    relativePath: "app/api/webhook/route.ts",
    content:
      'export const POST = async (request) => {\n  const token = request.headers.get("x-webhook-token");\n  if (!isValidSecret(token)) return new Response("no");\n  return Response.json(await request.json());\n};\n',
  },
  {
    name: "webhook-signature-risk-negative-unicode-whitespace-helper",
    relativePath: "app/api/webhook/route.ts",
    content:
      'export const POST = async (request) => {\n  if (!isValidSecret\u00a0(request.headers.get("x-signature"))) return new Response("no");\n  return Response.json(await request.json());\n};\n',
  },
  {
    name: "webhook-signature-risk-positive-line-continuation-string",
    relativePath: "src/server/receiver.ts",
    content:
      'const label = "webhook\\\ncopy";\nexport async function POST(request) {\n  return Response.json(await request.json());\n}\n',
  },
  {
    name: "webhook-signature-risk-positive-carriage-return-dot",
    relativePath: "app/api/webhook/route.ts",
    content:
      "const verify\rsignature = false;\nexport async function POST(request) {\n  return Response.json(await request.json());\n}\n",
  },
  {
    name: "active-svg-metadata-and-location",
    relativePath: "public/logo.svg",
    content: '<svg xmlns="http://www.w3.org/2000/svg">\n  <script>alert(1)</script>\n</svg>\n',
  },
  {
    name: "active-svg-unicode-column",
    relativePath: "public/unicode.svg",
    content: "<svg>😀<script>alert(1)</script></svg>\n",
  },
  {
    name: "inert-svg",
    relativePath: "public/logo.svg",
    content: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" /></svg>\n',
  },
  {
    name: "dangerously-allow-svg-config",
    relativePath: "next.config.ts",
    content: "const config = { images: { dangerouslyAllowSVG: true } };\nexport default config;\n",
  },
  {
    name: "executable-svg-embed",
    relativePath: "src/components/diagram.tsx",
    content:
      'export const Diagram = () => <object data="/uploads/diagram.svg" type="image/svg+xml" />;\n',
  },
  {
    name: "dangerous-html-prop",
    relativePath: "src/components/raw.tsx",
    content:
      "export const Raw = ({ unsafeHtml }) => <div dangerouslySetInnerHTML={{ __html: unsafeHtml }} />;\n",
  },
  {
    name: "dangerous-html-non-katex-replace-all",
    relativePath: "src/components/raw.tsx",
    content:
      'export const Raw = ({ html }) => <div dangerouslySetInnerHTML={{ __html: props.html.replaceAll("<", "&lt;") }} />;\n',
  },
  {
    name: "dangerous-html-js-word-boundary",
    relativePath: "src/components/raw.tsx",
    content: "export const write = (é) => édocument.write(props.html);\n",
  },
  {
    name: "dangerous-html-unicode-sanitizer-path",
    relativePath: "src/components/ſanitized-html.tsx",
    content:
      "export const Raw = ({ unsafeHtml }) => <div dangerouslySetInnerHTML={{ __html: unsafeHtml }} />;\n",
  },
  {
    name: "dangerous-html-unicode-sanitizer-lookalike",
    relativePath: "src/components/raw.tsx",
    content:
      "export const Raw = ({ html }) => <div dangerouslySetInnerHTML={{ __html: ſanitizeHtml(props.html) }} />;\n",
  },
  {
    name: "dangerous-html-static-multiline-script-template",
    relativePath: "app/components/theme-switcher.tsx",
    content: `export function ThemeSwitcherScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: \`
          (function() {
            var theme = localStorage.getItem("theme");
            if (theme) {
              document.documentElement.setAttribute("data-theme", theme);
            }
          })();
        \`,
      }}
    />
  );
}
`,
  },
  {
    name: "dangerous-html-multiline-serialized-script-callback",
    relativePath: "app/layout.tsx",
    content: [
      "const bootstrap = `(${String(function applyTheme() {",
      '  const theme = localStorage.getItem("theme");',
      "  document.documentElement.dataset.theme = theme;",
      "})})();`;",
      "export const Theme = () => (",
      "  <script dangerouslySetInnerHTML={{ __html: bootstrap }} />",
      ");",
    ].join("\n"),
  },
  {
    name: "dangerous-html-multiline-declared-template-taint",
    relativePath: "src/preview.tsx",
    content:
      "const markup = `<div>\n${props.html}\n</div>`;\nexport const Preview = () => <div dangerouslySetInnerHTML={{ __html: markup }} />;\n",
  },
  {
    name: "dangerous-html-terminal-template-interpolation",
    relativePath: "src/preview.tsx",
    content:
      "const markup = `${props.html}`;\nexport const Preview = () => <div dangerouslySetInnerHTML={{ __html: markup }} />;\n",
  },
  {
    name: "dangerous-html-unicode-after-template-interpolation",
    relativePath: "src/preview.tsx",
    content:
      "const markup = `${props.html}é`;\nexport const Preview = () => <div dangerouslySetInnerHTML={{ __html: markup }} />;\n",
  },
  {
    name: "dangerous-html-adjacent-template-interpolations",
    relativePath: "src/preview.tsx",
    content:
      "const markup = `${safeHtml}${props.html}`;\nexport const Preview = () => <div dangerouslySetInnerHTML={{ __html: markup }} />;\n",
  },
  {
    name: "dangerous-html-benign-terminal-template-interpolation",
    relativePath: "src/preview.tsx",
    content:
      "const markup = `${label}`;\nexport const Preview = () => <div dangerouslySetInnerHTML={{ __html: markup }} />;\n",
  },
  {
    name: "dangerous-html-benign-template-interpolation-before-unicode",
    relativePath: "src/preview.tsx",
    content:
      "const markup = `${label}é`;\nexport const Preview = () => <div dangerouslySetInnerHTML={{ __html: markup }} />;\n",
  },
  {
    name: "dangerous-html-benign-multiline-template-interpolation",
    relativePath: "src/preview.tsx",
    content:
      "const markup = `localStorage\n${label}\nquery`;\nexport const Preview = () => <div dangerouslySetInnerHTML={{ __html: markup }} />;\n",
  },
  {
    name: "dangerous-html-sanitized",
    relativePath: "src/components/safe.tsx",
    content:
      "export const Safe = ({ html }) => <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;\n",
  },
  {
    name: "dangerous-html-comment",
    relativePath: "src/components/comment.tsx",
    content: "// element.innerHTML = props.html;\nexport const Comment = () => <div>safe</div>;\n",
  },
  {
    name: "dangerous-html-root-test-gate",
    relativePath: "test-katex-error.tsx",
    content:
      "export const Preview = ({ html }) => <span dangerouslySetInnerHTML={{ __html: html }} />;\n",
  },
  {
    name: "dangerous-html-nested-test-prefix",
    relativePath: "src/test-katex-error.tsx",
    content:
      "export const Preview = ({ html }) => <span dangerouslySetInnerHTML={{ __html: html }} />;\n",
  },
  {
    name: "dangerous-html-generated-bundle-gate",
    relativePath: "public/widget.global.js",
    content: "element.innerHTML = props.html;\n",
    isGeneratedBundle: true,
  },
  {
    name: "nosql-request-json",
    relativePath: "src/server/db/users.ts",
    content:
      "export const findUsers = (request, collection) => collection.find(JSON.parse(request.query.filter));\n",
  },
  {
    name: "nosql-static-query",
    relativePath: "src/server/db/static.ts",
    content: 'export const findUsers = (collection) => collection.find({ role: "member" });\n',
  },
  {
    name: "raw-sql-unsafe",
    relativePath: "src/server/raw-sql.ts",
    content:
      "export const query = (prisma, id) => prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${id}'`);\n",
  },
  {
    name: "raw-sql-parameterized",
    relativePath: "src/server/safe-sql.ts",
    content: 'export const query = (database, id) => database.whereRaw("id = ?", [id]);\n',
  },
  {
    name: "raw-sql-driver-escaped",
    relativePath: "src/server/escaped-sql.ts",
    content:
      'export const query = (connection, request) => connection.query("SELECT " + connection.escapeId(request.body.column));\n',
  },
  {
    name: "unsafe-json-template",
    relativePath: "src/server/handler.ts",
    content:
      "export const buildHtml = (data) => `<script>window.__DATA__ = ${JSON.stringify(data)};</script>`;\n",
  },
  {
    name: "unsafe-json-nonterminal-template-junction",
    relativePath: "src/server/open-api.ts",
    content:
      "export const buildHtml = (schema) => `<script>\n  ${escapeJsonForHtml(JSON.stringify(schema))}\n</script>`;\n",
  },
  {
    name: "unsafe-json-runtime-code",
    relativePath: "src/server/runtime.ts",
    content:
      "export const html = `<script>window.send = (value) => postMessage(JSON.stringify(value));</script>`;\n",
  },
  {
    name: "unsafe-json-react-child",
    relativePath: "src/component.tsx",
    content:
      "export const Register = ({ ids }) => <script>{`window.register(${JSON.stringify(ids)})`}</script>;\n",
  },
  {
    name: "unsafe-json-escaped-output",
    relativePath: "src/hydrate-safe.tsx",
    content:
      'export const Safe = ({ data }) => <div dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "&lt;") }} />;\n',
  },
  {
    name: "unsafe-json-script-tag-boundary",
    relativePath: "src/scripture.ts",
    content:
      "export const buildHtml = (data) => `<scripture>${JSON.stringify(data)}</scripture>`;\n",
  },
  {
    name: "unsafe-json-pattern-priority",
    relativePath: "src/two-sinks.tsx",
    content:
      "export const inline = (data) => `<script>${JSON.stringify(data)}</script>`;\nexport const injected = (data) => <div dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;\n",
  },
  {
    name: "unsafe-json-line-continuation-literal",
    relativePath: "src/line-continuation.tsx",
    content:
      'export const value = <div dangerouslySetInnerHTML={{ __html: JSON.stringify("safe\\\ntext") }} />;\n',
  },
  {
    name: "unsafe-json-replace-all-is-not-canonical-escape",
    relativePath: "src/replace-all.tsx",
    content:
      'export const value = (data) => <div dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll("<", "&lt;") }} />;\n',
  },
  {
    name: "supabase-client-write",
    relativePath: "src/lib/create-team.ts",
    content:
      'export const createTeam = async (ownerId) => supabase.from("teams").insert({ ownerId, role: "admin" });\n',
  },
  {
    name: "supabase-client-uppercase-extension",
    relativePath: "src/lib/create-team.TS",
    content:
      'export const createTeam = async (ownerId) => supabase.from("teams").insert({ ownerId });\n',
  },
  {
    name: "supabase-server-path-gate",
    relativePath: "src/server/create-team.ts",
    content:
      'export const createTeam = async (ownerId) => supabase.from("teams").insert({ ownerId, role: "admin" });\n',
  },
  {
    name: "supabase-use-server-directive",
    relativePath: "src/actions/create-team.ts",
    content:
      '/** license */\n"use server"\nexport const createTeam = async (ownerId) => supabase.from("teams").insert({ ownerId, role: "admin" });\n',
  },
  {
    name: "supabase-commented-use-server",
    relativePath: "src/lib/commented-directive.ts",
    content:
      '/* "use server" */\nexport const createTeam = async (ownerId) => supabase.from("teams").insert({ ownerId, role: "admin" });\n',
  },
  {
    name: "supabase-disable-rls",
    relativePath: "supabase/migrations/001_disable.sql",
    content: "alter table if exists public.accounts disable row level security;\n",
  },
  {
    name: "supabase-open-write-policy-unicode-column",
    relativePath: "supabase/migrations/002_open.sql",
    content:
      "select '😀'; create policy open_write on accounts for all using (true) with check (true);\n",
  },
  {
    name: "supabase-public-read-policy",
    relativePath: "supabase/migrations/003_read.sql",
    content: "create policy public_read on accounts for select using (true);\n",
  },
  {
    name: "supabase-service-role-policy",
    relativePath: "supabase/migrations/004_service.sql",
    content:
      "create policy service_write on accounts for all to service_role using (true) with check (true);\n",
  },
  {
    name: "supabase-authenticated-write-policy",
    relativePath: "supabase/migrations/004_authenticated.sql",
    content:
      "create policy member_write on accounts for all to authenticated using (true) with check (true);\n",
  },
  {
    name: "supabase-mixed-role-write-policy",
    relativePath: "supabase/migrations/004_mixed.sql",
    content:
      "create policy mixed_write on accounts for all to service_role, authenticated using (true);\n",
  },
  {
    name: "supabase-service-role-body-bypass",
    relativePath: "supabase/migrations/004_bypass.sql",
    content: "create policy bypass on accounts for update using (auth.role() = 'service_role');\n",
  },
  {
    name: "supabase-statement-scoped-role-policy",
    relativePath: "supabase/migrations/004_scoped.sql",
    content:
      "create policy server_write on accounts for all to service_role using (true);\ncreate policy open_write on accounts for insert with check (true);\n",
  },
  {
    name: "supabase-commented-policy",
    relativePath: "supabase/migrations/005_comment.sql",
    content: "-- create policy open_write on accounts for all using (true);\n",
  },
  {
    name: "supabase-public-table-without-rls",
    relativePath: "supabase/migrations/010_create.sql",
    content: "create table public.notes (id uuid primary key);\n",
  },
  {
    name: "supabase-public-table-with-rls",
    relativePath: "supabase/migrations/011_create.sql",
    content:
      "create table public.notes (id uuid primary key);\nalter table public.notes enable row level security;\n",
  },
  {
    name: "supabase-public-table-quoted-cross-form",
    relativePath: "supabase/migrations/011_quoted.sql",
    content:
      'create table public.notes (id uuid primary key);\nalter table "public"."notes" enable row level security;\n',
  },
  {
    name: "supabase-sibling-table-enable",
    relativePath: "supabase/migrations/011_sibling.sql",
    content:
      "create table public.covered (id uuid primary key);\nalter table public.covered enable row level security;\ncreate table public.exposed (id uuid primary key);\n",
  },
  {
    name: "supabase-enable-before-create",
    relativePath: "supabase/migrations/011_before.sql",
    content:
      "alter table if exists public.notes enable row level security;\ncreate table public.notes (id uuid primary key);\n",
  },
  {
    name: "supabase-multiple-public-tables-order",
    relativePath: "supabase/migrations/011_multiple.sql",
    content:
      "create table public.first_table (id uuid primary key);\ncreate table public.second_table (id uuid primary key);\n",
  },
  {
    name: "supabase-private-table",
    relativePath: "supabase/migrations/012_private.sql",
    content: "create table private.notes (id uuid primary key);\n",
  },
  {
    name: "supabase-dynamic-rls-enable",
    relativePath: "supabase/migrations/013_dynamic.sql",
    content:
      "create table public.notes (id uuid primary key);\ndo $$ begin execute 'alter table public.notes enable row level security'; end $$;\n",
  },
  {
    name: "supabase-perform-does-not-enable-rls",
    relativePath: "supabase/migrations/013_perform.sql",
    content:
      "create table public.notes (id uuid primary key);\ndo $$ begin perform 'alter table public.notes enable row level security'; end $$;\n",
  },
  {
    name: "supabase-function-body-does-not-enable-rls",
    relativePath: "supabase/migrations/013_function.sql",
    content:
      "create table public.notes (id uuid primary key);\ncreate function enable_notes() returns void as $$ begin alter table public.notes enable row level security; end $$ language plpgsql;\n",
  },
  {
    name: "supabase-table-outside-migrations",
    relativePath: "db/migrations/014_create.sql",
    content: "create table public.notes (id uuid primary key);\n",
  },
];

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNativeScanBinding = (value: unknown): value is NativeScanBinding =>
  isRecord(value) &&
  typeof value.reactDoctorNativeScanRuleIds === "function" &&
  typeof value.scanReactDoctorFile === "function" &&
  typeof value.scanReactDoctorFileSource === "function";

const readOption = (name: string): string | undefined => {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex < 0) return undefined;
  const value = process.argv[optionIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
};

const resolveBindingPath = (): string => {
  const configuredPath =
    readOption("--binding") ?? process.env.REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH;
  if (configuredPath !== undefined) return path.resolve(configuredPath);
  const outputDirectory = path.join(repositoryRoot, "dist", "native-oxlint");
  const candidates = fs.existsSync(outputDirectory)
    ? fs
        .readdirSync(outputDirectory)
        .filter((fileName) => fileName.endsWith(".node"))
        .sort()
        .map((fileName) => path.join(outputDirectory, fileName))
    : [];
  if (candidates.length !== 1) {
    throw new Error(
      "Pass --binding or set REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH when dist/native-oxlint does not contain exactly one binding.",
    );
  }
  return candidates[0];
};

const loadBinding = (bindingPath: string): NativeScanBinding => {
  if (!fs.existsSync(bindingPath)) throw new Error(`Native binding not found: ${bindingPath}`);
  const nativeModule: NativeModuleContainer = { exports: {} };
  process.dlopen(nativeModule, bindingPath);
  const binding = nativeModule.exports;
  if (!isNativeScanBinding(binding)) {
    const bindingKeys = isRecord(binding) ? Object.keys(binding).join(", ") : typeof binding;
    throw new Error(`Native binding does not export the scan API (${bindingKeys}): ${bindingPath}`);
  }
  return binding;
};

const makeFixture = (input: ScanParityFixtureInput, absoluteRoot: string): ScanParityFixture => ({
  name: input.name,
  absolutePath: path.join(absoluteRoot, input.relativePath),
  relativePath: input.relativePath,
  content: input.content,
  expectedRuleCounts: input.expectedRuleCounts,
  isGeneratedBundle:
    input.isGeneratedBundle ??
    classifySecurityScanFile(input.relativePath)?.isGeneratedBundleByName ??
    false,
});

const collectFiles = (directory: string): string[] => {
  const files: string[] = [];
  const visit = (currentDirectory: string): void => {
    for (const entry of fs
      .readdirSync(currentDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  };
  visit(directory);
  return files;
};

const collectCoreFixtures = (): ScanParityFixture[] => {
  const fixturesRoot = path.join(
    repositoryRoot,
    "packages/core/tests/fixtures/check-security-scan",
  );
  return CORE_FIXTURE_DIRECTORIES.flatMap((fixtureDirectoryName) => {
    const fixtureDirectory = path.join(fixturesRoot, fixtureDirectoryName);
    return collectFiles(fixtureDirectory).map((absolutePath) => {
      const relativePath = path.relative(fixtureDirectory, absolutePath).split(path.sep).join("/");
      return makeFixture(
        {
          name: `core:${fixtureDirectoryName}:${relativePath}`,
          relativePath,
          content: fs.readFileSync(absolutePath, "utf8"),
        },
        fixtureDirectory,
      );
    });
  });
};

const collectLivenessFixtures = (virtualRoot: string): ScanParityFixture[] =>
  RETAINED_SCAN_RULE_IDS.map((ruleId) => {
    const fixture = livenessFixtures[ruleId];
    if (fixture === undefined) throw new Error(`Missing liveness fixture for ${ruleId}`);
    return makeFixture(
      {
        name: `liveness:${ruleId}`,
        relativePath: (fixture.filePath ?? `src/${ruleId}.tsx`).replace(/^\/+/, ""),
        content: fixture.code,
        isGeneratedBundle: fixture.isGeneratedBundle,
      },
      virtualRoot,
    );
  });

const createCrossFileFixtures = (temporaryRoot: string): ScanParityFixture[] => {
  const directory = path.join(temporaryRoot, "cross-file-katex");
  const sourceDirectory = path.join(directory, "src");
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDirectory, "safe-helper.ts"),
    `import katex from "katex";
const escapeHtml = (value: string) => value.replaceAll("<", "&lt;");
export const renderKaTeX = (value: string) => {
  try { return katex.renderToString(value); }
  catch { return \`<span>\${escapeHtml(value)}</span>\`; }
};
`,
  );
  fs.writeFileSync(
    path.join(sourceDirectory, "raw-helper.ts"),
    `import katex from "katex";
export const renderMathToHtml = (value: string) => {
  try { return katex.renderToString(value); }
  catch { return value; }
};
`,
  );
  fs.writeFileSync(
    path.join(sourceDirectory, "máth.ts"),
    `import katex from "katex";
export const renderUnicodePathKaTeX = (value: string) => katex.renderToString(value);
`,
  );
  return [
    makeFixture(
      {
        name: "dangerous-html-cross-file-safe-katex",
        relativePath: "src/safe.tsx",
        content: `import { renderKaTeX } from "./safe-helper";
const html = renderKaTeX(props.value);
export const Math = () => <div dangerouslySetInnerHTML={{ __html: html }} />;
`,
      },
      directory,
    ),
    makeFixture(
      {
        name: "dangerous-html-cross-file-raw-fallback",
        relativePath: "src/raw.tsx",
        content: `import { renderMathToHtml } from "./raw-helper";
export const Math = () => <div dangerouslySetInnerHTML={{ __html: renderMathToHtml(props.value) }} />;
`,
      },
      directory,
    ),
    makeFixture(
      {
        name: "dangerous-html-cross-file-unicode-path",
        relativePath: "src/unicode-path.tsx",
        content: `import { renderUnicodePathKaTeX } from "./máth";
export const Math = () => <div dangerouslySetInnerHTML={{ __html: renderUnicodePathKaTeX(props.value) }} />;
`,
      },
      directory,
    ),
  ];
};

const normalizeJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const run = (): void => {
  const bindingPath = resolveBindingPath();
  const binding = loadBinding(bindingPath);
  const advertisedRuleIds = binding.reactDoctorNativeScanRuleIds();
  assert.ok(Array.isArray(advertisedRuleIds), "Native scan rule IDs must be an array");
  assert.ok(
    advertisedRuleIds.every((ruleId) => typeof ruleId === "string"),
    "Native scan rule IDs must contain only strings",
  );
  assert.equal(new Set(advertisedRuleIds).size, advertisedRuleIds.length, "Duplicate scan rule ID");
  assert.deepEqual([...advertisedRuleIds].sort(), RETAINED_SCAN_RULE_IDS);

  const emptySelection = {
    absolutePath: "C:\\project\\máth\\🙂.ts",
    relativePath: "máth\\🙂.ts",
    content: 'const value = "\0🙂e\u0301\uFEFF";\r\n',
    isGeneratedBundle: true,
    ruleIds: [],
  };
  assert.equal(binding.scanReactDoctorFile(JSON.stringify(emptySelection)), "{}");
  assert.equal(
    binding.scanReactDoctorFileSource(
      emptySelection.absolutePath,
      emptySelection.relativePath,
      emptySelection.content,
      emptySelection.isGeneratedBundle,
      emptySelection.ruleIds,
    ),
    "{}",
  );
  for (const field of ["absolutePath", "relativePath", "content", "ruleIds"]) {
    for (const surrogate of ["\uD800", "\uDC00"]) {
      assert.throws(
        () =>
          binding.scanReactDoctorFile(
            JSON.stringify({
              ...emptySelection,
              [field]: field === "ruleIds" ? [surrogate] : surrogate,
            }),
          ),
        /Invalid React Doctor scan input/,
      );
    }
  }

  const canonicalEntryById = new Map(
    REACT_DOCTOR_SCAN_RULES.filter((entry) => RETAINED_SCAN_RULE_IDS.includes(entry.id)).map(
      (entry) => [entry.id, entry],
    ),
  );
  assert.deepEqual([...canonicalEntryById.keys()].sort(), RETAINED_SCAN_RULE_IDS);

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-scan-parity-"));
  try {
    const fixtures = [
      ...collectLivenessFixtures(temporaryRoot),
      ...REGRESSION_FIXTURE_INPUTS.map((input) => makeFixture(input, temporaryRoot)),
      ...collectCoreFixtures(),
      ...createCrossFileFixtures(temporaryRoot),
    ];
    const firingFixtureCountByRule = new Map(RETAINED_SCAN_RULE_IDS.map((ruleId) => [ruleId, 0]));
    const parityDifferences: string[] = [];

    for (const fixture of fixtures) {
      const scannedFile = {
        absolutePath: fixture.absolutePath,
        relativePath: fixture.relativePath,
        content: fixture.content,
        isGeneratedBundle: fixture.isGeneratedBundle,
      };
      const canonicalFindingsByRule = Object.fromEntries(
        RETAINED_SCAN_RULE_IDS.map((ruleId) => {
          const entry = canonicalEntryById.get(ruleId);
          const scan = entry?.rule.scan;
          if (typeof scan !== "function") throw new Error(`Missing canonical scan for ${ruleId}`);
          const findings = scan(scannedFile);
          const expectedCount = fixture.expectedRuleCounts?.[ruleId];
          if (expectedCount !== undefined) {
            assert.equal(
              findings.length,
              expectedCount,
              `${fixture.name}: ${ruleId} control count`,
            );
          }
          if (findings.length > 0) {
            firingFixtureCountByRule.set(ruleId, (firingFixtureCountByRule.get(ruleId) ?? 0) + 1);
          }
          return [ruleId, normalizeJson(findings)];
        }),
      );
      for (const ruleIds of [RETAINED_SCAN_RULE_IDS, [...RETAINED_SCAN_RULE_IDS].reverse()]) {
        for (const [api, nativeOutputJson] of [
          ["json", binding.scanReactDoctorFile(JSON.stringify({ ...scannedFile, ruleIds }))],
          [
            "source",
            binding.scanReactDoctorFileSource(
              scannedFile.absolutePath,
              scannedFile.relativePath,
              scannedFile.content,
              scannedFile.isGeneratedBundle,
              ruleIds,
            ),
          ],
        ]) {
          assert.equal(
            typeof nativeOutputJson,
            "string",
            `${fixture.name} (${api}): native scan output must be JSON text`,
          );
          const nativeFindingsByRule: unknown = JSON.parse(nativeOutputJson);
          try {
            assert.deepEqual(
              nativeFindingsByRule,
              canonicalFindingsByRule,
              `${fixture.name} (${api}, ${fixture.relativePath}, first rule: ${ruleIds[0]})`,
            );
          } catch (error) {
            parityDifferences.push(error instanceof Error ? error.message : String(error));
          }
        }
      }
    }

    for (const [ruleId, firingFixtureCount] of firingFixtureCountByRule) {
      assert.ok(firingFixtureCount > 0, `${ruleId} has no firing parity fixture`);
    }
    if (parityDifferences.length > 0) {
      throw new Error(
        `Native scan parity found ${parityDifferences.length} mismatched comparisons:\n\n${parityDifferences.join("\n\n")}`,
      );
    }
    process.stdout.write(
      `Native scan parity passed: ${RETAINED_SCAN_RULE_IDS.length} rules, ${fixtures.length} fixtures, JSON and source APIs, forward and reverse rule order.\n`,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

run();
