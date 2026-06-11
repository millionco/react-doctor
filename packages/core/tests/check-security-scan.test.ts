import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkSecurityScan } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { REACT_DOCTOR_RULES } from "oxlint-plugin-react-doctor";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures", "check-security-scan");

let temporaryRoot: string;

const writeFile = (relativePath: string, content: string): void => {
  const absolutePath = path.join(temporaryRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
};

const rulesOf = (diagnostics: ReadonlyArray<Diagnostic>): ReadonlySet<string> =>
  new Set(diagnostics.map((diagnostic) => diagnostic.rule));

const fixtureRules = (fixtureName: string): ReadonlySet<string> =>
  rulesOf(checkSecurityScan(path.join(FIXTURES_DIRECTORY, fixtureName)));

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-security-scan-"));
});

afterEach(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe("checkSecurityScan", () => {
  describe("Eva-grounded fixtures", () => {
    it("flags an a16z-style full server env object shipped in a browser chunk", () => {
      expect(fixtureRules("eva-a16z-env-bundle")).toEqual(
        new Set(["artifact-env-leak", "artifact-secret-leak"]),
      );
    });

    it("flags a GamerSafer-style public React env secret leak in source and build output", () => {
      expect(fixtureRules("eva-gamersafer-public-env")).toEqual(
        new Set(["artifact-env-leak", "artifact-secret-leak", "public-env-secret-name"]),
      );
    });

    it("flags minified/generated widget bundles outside normal framework output folders", () => {
      expect(fixtureRules("eva-minified-widget-bundle")).toEqual(new Set(["artifact-secret-leak"]));
    });

    it("flags Mintlify-style MDX SSR plus cross-tenant static asset exposure", () => {
      expect(fixtureRules("eva-mintlify-docs-platform")).toEqual(
        new Set(["active-static-asset", "mdx-ssr-execution-risk", "tenant-static-proxy-risk"]),
      );
    });

    it("flags Arc and Chattr style Firebase authorization mistakes", () => {
      expect(fixtureRules("eva-arc-chattr-firebase")).toEqual(
        new Set([
          "artifact-baas-authority-surface",
          "firebase-client-owned-authz-field",
          "firebase-permissive-rules",
          "firebase-query-filter-as-auth",
        ]),
      );
    });

    it("flags a ToDesktop-style release pipeline where install scripts run near release secrets", () => {
      expect(fixtureRules("eva-todesktop-release-pipeline")).toEqual(
        new Set(["build-pipeline-secret-boundary"]),
      );
    });

    it("flags an ASUS DriverHub-style localhost RPC and updater bridge", () => {
      expect(fixtureRules("mrbruh-asus-local-rpc")).toEqual(
        new Set(["local-rpc-native-bridge-risk", "plugin-update-trust-risk"]),
      );
    });

    it("flags a Fooocus-style metadata eval import path", () => {
      expect(fixtureRules("mrbruh-fooocus-metadata-eval")).toEqual(
        new Set(["import-metadata-execution-risk"]),
      );
    });

    it("flags a Lyra-style iframe redirect chain with prefilled privileged URL parameters", () => {
      expect(fixtureRules("lyra-clickjacking-redirect-chain")).toEqual(
        new Set(["clickjacking-redirect-risk", "url-prefilled-privileged-action"]),
      );
    });

    it("flags a Lyra-style SVG-filtered iframe clickjacking primitive", () => {
      expect(fixtureRules("lyra-svg-filter-clickjacking")).toEqual(
        new Set(["svg-filter-clickjacking-risk"]),
      );
    });

    it("flags a Supabase service-role key exposed through public client config", () => {
      expect(fixtureRules("supabase-service-role-public-client")).toEqual(
        new Set(["artifact-env-leak", "artifact-secret-leak", "public-env-secret-name"]),
      );
    });

    it("flags common webhook and provider tokens shipped in browser bundles", () => {
      expect(fixtureRules("broad-provider-token-bundle")).toEqual(
        new Set(["artifact-secret-leak"]),
      );
    });

    it("flags permissive Supabase RLS plus client-owned tenant and role columns", () => {
      expect(fixtureRules("supabase-rls-client-owned-authz")).toEqual(
        new Set(["supabase-client-owned-authz-field", "supabase-rls-policy-risk"]),
      );
    });

    it("flags docs-domain credentialed CORS and broad first-party auth cookies", () => {
      expect(fixtureRules("docs-cookie-cors-trust")).toEqual(new Set(["cors-cookie-trust-risk"]));
    });

    it("flags public debug logs and source maps that expose server env references", () => {
      expect(fixtureRules("public-debug-sourcemap-leak")).toEqual(
        new Set(["artifact-env-leak", "artifact-secret-leak", "public-debug-artifact"]),
      );
    });

    it("flags checked-in private release key material and key-shaped CI variables", () => {
      expect(fixtureRules("release-key-material-leak")).toEqual(new Set(["key-lifecycle-risk"]));
    });

    it("flags committed env, service-account, and npm auth credential files", () => {
      expect(fixtureRules("repository-secret-files")).toEqual(
        new Set(["key-lifecycle-risk", "repository-secret-file"]),
      );
    });

    it("flags ported static matcher patterns for postMessage, redirect-following fetches, and dynamic HTML", () => {
      expect(fixtureRules("ported-static-matcher-patterns")).toEqual(
        new Set(["dangerous-html-sink", "postmessage-origin-risk", "untrusted-redirect-following"]),
      );
    });

    it("keeps safe postMessage, manual redirect, and static HTML patterns quiet", () => {
      expect(
        checkSecurityScan(path.join(FIXTURES_DIRECTORY, "ported-static-matcher-safe-patterns")),
      ).toEqual([]);
    });

    it("flags ported agent, MCP, SQL, NoSQL, and command execution matcher patterns", () => {
      expect(fixtureRules("ported-agent-mcp-tool-risks")).toEqual(
        new Set(["agent-tool-capability-risk", "mcp-tool-capability-risk"]),
      );
      expect(fixtureRules("ported-database-and-command-risks")).toEqual(
        new Set(["command-execution-input-risk", "nosql-injection-risk", "raw-sql-injection-risk"]),
      );
    });

    it("keeps safe agent tools and parameterized database calls quiet", () => {
      expect(
        checkSecurityScan(path.join(FIXTURES_DIRECTORY, "ported-agent-database-safe-patterns")),
      ).toEqual([]);
    });

    it("flags ported path traversal, git URL injection, webhook signature, and crypto risks", () => {
      expect(fixtureRules("ported-web-security-risks")).toEqual(
        new Set([
          "git-provider-url-injection-risk",
          "insecure-crypto-risk",
          "path-traversal-risk",
          "webhook-signature-risk",
        ]),
      );
    });

    it("keeps safe path, git URL, webhook signature, and crypto patterns quiet", () => {
      expect(
        checkSecurityScan(path.join(FIXTURES_DIRECTORY, "ported-web-security-safe-patterns")),
      ).toEqual([]);
    });

    it("keeps redacted env examples quiet", () => {
      expect(
        checkSecurityScan(path.join(FIXTURES_DIRECTORY, "repository-secret-examples")),
      ).toEqual([]);
    });

    it("keeps public Supabase chat browser bundles quiet when they expose no authority fields", () => {
      expect(
        checkSecurityScan(path.join(FIXTURES_DIRECTORY, "real-supabase-chat-browser-bundle")),
      ).toEqual([]);
    });

    it("keeps known browser-facing analytics, license, map, and search keys quiet", () => {
      expect(checkSecurityScan(path.join(FIXTURES_DIRECTORY, "real-public-env-keys"))).toEqual([]);
    });

    it("keeps server-only Supabase service-role routes quiet", () => {
      expect(
        checkSecurityScan(path.join(FIXTURES_DIRECTORY, "real-server-service-role-route")),
      ).toEqual([]);
    });

    it("keeps public-read private-write Supabase RLS policies quiet", () => {
      expect(
        checkSecurityScan(path.join(FIXTURES_DIRECTORY, "real-supabase-public-read-private-write")),
      ).toEqual([]);
    });

    it("stays quiet on a hardened app with scoped rules and public-only browser config", () => {
      expect(checkSecurityScan(path.join(FIXTURES_DIRECTORY, "safe-hardened-app"))).toEqual([]);
    });
  });

  it("covers the P0-P2 P0-P2 security analyzer families", () => {
    writeFile(
      ".next/static/chunks/app.js",
      `window.__ENV__ = { AWS_SECRET_ACCESS_KEY: "very-secret", AWS_ACCESS_KEY_ID: "AKIAABCDEFGHIJKLMNOP" };`,
    );
    writeFile("public/debug.log", "DATABASE_URL=postgres://user:pass@example.com/db\nstack trace");
    writeFile("public/xss.svg", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" />`);
    writeFile(
      "firestore.rules",
      `service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if request.auth != null; } } }`,
    );
    writeFile(
      "src/firebase-client.tsx",
      `export const save = () => setDoc(ref, { creatorID: profile.id, role: "SuperAdmin" }); db.collection("sessions").where("userId", "==", userId);`,
    );
    writeFile(
      "supabase/migrations/001.sql",
      `alter table profiles disable row level security; create policy "open" on profiles using (true);`,
    );
    writeFile(
      "src/supabase-client.ts",
      `export const save = (supabase, ownerId) => supabase.from("docs").upsert({ ownerId, role: "admin" });`,
    );
    writeFile(
      "package.json",
      JSON.stringify({ scripts: { postinstall: "node scripts/postinstall.js" } }, null, 2),
    );
    writeFile(
      ".github/workflows/release.yml",
      `steps:\n  - run: pnpm install\n    env:\n      RELEASE_TOKEN: \${{ secrets.RELEASE_TOKEN }}\n`,
    );
    writeFile(
      "app/api/static/[tenant]/route.ts",
      `export const GET = async (_, { params }) => fetch(CDN + "/" + params.tenant + "/" + decodeURIComponent(params.path.join("/")));`,
    );
    // Untrusted-shaped source: rendering a project's own docs MDX is the
    // benign default, so the rule keys on request/tenant-shaped input.
    writeFile(
      "src/render-mdx.ts",
      `import { compileMDX } from "next-mdx-remote/rsc"; export const render = (req) => compileMDX({ source: req.body.markdown });`,
    );
    writeFile(
      "src/local-bridge.ts",
      `if (origin.includes("driverhub.asus.com")) new WebSocket("ws://127.0.0.1:53000/UpdateApp");`,
    );
    writeFile(
      "src/share-dialog.tsx",
      `const email = new URLSearchParams(location.search).get("userstoinvite"); const role = searchParams.get("role");`,
    );
    writeFile(
      "src/redirect.ts",
      `export const GET = (request) => redirect(request.nextUrl.searchParams.get("next"));`,
    );
    writeFile(
      "src/import-metadata.ts",
      `export const apply = (metadata) => eval(metadata.exifPreset);`,
    );
    writeFile(
      "src/message-listener.ts",
      `window.addEventListener("message", (event) => window.dispatchEvent(new CustomEvent("x", { detail: event.data })));`,
    );
    writeFile(
      "app/api/preview/route.ts",
      `export const POST = async (request) => { const { imageUrl } = await request.json(); return fetch(imageUrl); };`,
    );
    writeFile(
      "src/remote-html.tsx",
      `export const RemoteHtml = ({ html }) => <div dangerouslySetInnerHTML={{ __html: html }} />;`,
    );
    writeFile(
      "src/agents/tools/run-command.ts",
      `import { tool } from "ai"; import { execFile } from "node:child_process"; export const t = tool({ execute: async ({ command }) => execFile(command, []) });`,
    );
    writeFile(
      "src/mcp/server.ts",
      `import { McpServer } from "@modelcontextprotocol/sdk/server/index.js"; import { readFile } from "node:fs/promises"; const server = new McpServer({ name: "x", version: "1" }); server.tool("read_file", async ({ path }) => readFile(path, "utf-8"));`,
    );
    writeFile(
      "src/raw-sql.ts",
      "export const q = (prisma, id) => prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${id}'`);",
    );
    writeFile(
      "src/nosql.ts",
      "export const q = (collection, request) => collection.find(JSON.parse(request.body.filter));",
    );
    writeFile(
      "app/api/files/route.ts",
      `export const POST = async (request) => readFile(request.body.path, "utf-8");`,
    );
    // Request-shaped interpolation: bare `${owner}` parameters proved to be
    // internal config in practice, so the rule keys on request property reads.
    writeFile(
      "src/github-import.ts",
      "export const build = (req) => `https://api.github.com/repos/${req.query.owner}/${req.query.repo}`;",
    );
    writeFile(
      "app/api/stripe/webhook/route.ts",
      `export const POST = async (request) => { const event = await request.json(); return Response.json({ received: event.type }); };`,
    );
    writeFile("src/session-token.ts", `export const token = () => Math.random().toString(36);`);
    // Not under `scripts/`: build-script paths are excluded from production
    // source on purpose (see BUILD_SCRIPT_CONTEXT_PATTERN).
    writeFile(
      "backend/report.py",
      "import os\ndef run(request):\n    os.system(f\"wkhtmltopdf {request.args['url']} /tmp/report.pdf\")\n",
    );
    writeFile(
      "src/updater.ts",
      `import { execFile } from "node:child_process"; export const update = (updateUrl) => execFile("installer", [updateUrl ?? "https://example.com/app.exe"]);`,
    );
    writeFile(
      "secrets/signing-key.txt",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n",
    );
    writeFile(
      "src/cors.ts",
      `headers.set("Access-Control-Allow-Credentials", "true"); headers.set("Access-Control-Allow-Origin", "https://docs.example.com"); res.setHeader("Set-Cookie", "session=abc; Domain=.example.com");`,
    );
    writeFile("next.config.js", `export default { images: { dangerouslyAllowSVG: true } };`);

    const rules = rulesOf(checkSecurityScan(temporaryRoot));

    expect(rules).toEqual(
      new Set([
        "active-static-asset",
        "artifact-env-leak",
        "artifact-secret-leak",
        "build-pipeline-secret-boundary",
        "clickjacking-redirect-risk",
        "cors-cookie-trust-risk",
        "firebase-client-owned-authz-field",
        "firebase-permissive-rules",
        "firebase-query-filter-as-auth",
        "import-metadata-execution-risk",
        "key-lifecycle-risk",
        "local-rpc-native-bridge-risk",
        "mdx-ssr-execution-risk",
        "plugin-update-trust-risk",
        "public-debug-artifact",
        "supabase-client-owned-authz-field",
        "supabase-rls-policy-risk",
        "tenant-static-proxy-risk",
        "postmessage-origin-risk",
        "untrusted-redirect-following",
        "dangerous-html-sink",
        "url-prefilled-privileged-action",
        "agent-tool-capability-risk",
        "mcp-tool-capability-risk",
        "raw-sql-injection-risk",
        "nosql-injection-risk",
        "command-execution-input-risk",
        "path-traversal-risk",
        "git-provider-url-injection-risk",
        "webhook-signature-risk",
        "insecure-crypto-risk",
      ]),
    );
  });

  it("stays quiet on public client keys, Firebase config alone, SVG images, and test keys", () => {
    writeFile(
      "public/app.js",
      `window.config = { firebase: { apiKey: "AIzaSyPublicNotASecret", projectId: "demo" }, sentry: "https://abc@o1.ingest.sentry.io/2", stripe: "pk_live_1234567890" };`,
    );
    writeFile("src/logo.tsx", `export const Logo = () => <img src="/logo.svg" alt="" />;`);
    writeFile(
      "tests/fixtures/private-key.txt",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture only\n",
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("adds Security metadata and source locations for direct pattern matches", () => {
    writeFile(
      "firestore.rules",
      `rules_version = "2";\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    allow read, write: if true;\n  }\n}\n`,
    );

    const diagnostics = checkSecurityScan(temporaryRoot);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      plugin: "react-doctor",
      rule: "firebase-permissive-rules",
      category: "Security",
      severity: "error",
      line: 4,
      column: 5,
    });
  });

  it("uses concrete locations for env leak shapes and public env secret names", () => {
    writeFile(
      "dist/assets/app.js.map",
      `window.__ENV__ = {\n  DATABASE_URL: "postgres://user:pass@example.com/app"\n};`,
    );
    writeFile(".env", "NEXT_PUBLIC_SECRET_TOKEN=placeholder\n");

    expect(checkSecurityScan(temporaryRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: "artifact-env-leak",
          line: 2,
          column: 3,
        }),
        expect.objectContaining({
          rule: "repository-secret-file",
          line: 1,
          column: 1,
        }),
      ]),
    );
  });

  it("uses concrete locations for package metadata secret values", () => {
    writeFile("package.json", `{\n  "token": "ghp_abcdefghijklmnopqrstuvwxyz123456"\n}\n`);

    expect(checkSecurityScan(temporaryRoot)).toEqual([
      expect.objectContaining({
        rule: "package-metadata-secret",
        line: 2,
        column: 13,
      }),
    ]);
  });

  it("reports postMessage handlers at the unsafe handler location", () => {
    writeFile(
      "src/message-listener.ts",
      `window.addEventListener("message", (event) => {\n  if (event.origin !== "https://example.com") return;\n  window.dispatchEvent(new CustomEvent("safe", { detail: event.data }));\n});\nwindow.addEventListener("message", (event) => {\n  window.dispatchEvent(new CustomEvent("unsafe", { detail: event.data }));\n});\n`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([
      expect.objectContaining({
        rule: "postmessage-origin-risk",
        line: 5,
        column: 1,
      }),
    ]);
  });

  it("reports postMessage handlers that read data before checking origin", () => {
    writeFile(
      "src/message-order.ts",
      `window.addEventListener("message", (event) => {\n  window.dispatchEvent(new CustomEvent("unsafe", { detail: event.data }));\n  if (event.origin !== "https://example.com") return;\n});\n`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([
      expect.objectContaining({
        rule: "postmessage-origin-risk",
        line: 1,
        column: 1,
      }),
    ]);
  });

  it("keeps unrelated redirect options quiet while scanning got shorthand calls", () => {
    writeFile(
      "app/api/config/route.ts",
      `const defaultOptions = { redirect: "follow" };\nexport const GET = async () => fetch("https://example.com", defaultOptions);\n`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);

    writeFile(
      "app/api/proxy/route.ts",
      `export const GET = async (request) => {\n  const targetUrl = request.nextUrl.searchParams.get("targetUrl");\n  return got.get(targetUrl);\n};\n`,
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("untrusted-redirect-following");
  });

  it("does not treat server-only Next build output as a browser artifact", () => {
    writeFile(
      ".next/server/app/page.js",
      `export const env = { AWS_SECRET_ACCESS_KEY: "server-only", AWS_ACCESS_KEY_ID: "AKIAABCDEFGHIJKLMNOP" };`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("does not treat ordinary package dist output as browser-shipped artifact output", () => {
    writeFile(
      "packages/api/dist/index.js",
      `export const databaseUrl = process.env.DATABASE_URL ?? "postgres://api:password@db.internal.example.com/api";`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("still reports a real secret when a public key appears in the same browser bundle", () => {
    writeFile(
      "dist/assets/app.js",
      `const publishable = "pk_live_1234567890"; const secret = "AKIAABCDEFGHIJKLMNOP";`,
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("artifact-secret-leak");
  });

  it("discovers one-line minified bundles even without a generated bundle filename", () => {
    const minifiedPrefix = `var bootstrap="${"a".repeat(21_000)}";`;
    writeFile(
      "packages/widget/client.js",
      `${minifiedPrefix}var env={AWS_ACCESS_KEY_ID:"AKIAABCDEFGHIJKLMNOP"};window.Widget=env;`,
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("artifact-secret-leak");
  });

  it("reports public env names that look secret-like in client source", () => {
    writeFile("src/client.tsx", `export const token = process.env.NEXT_PUBLIC_SECRET_TOKEN;`);

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("public-env-secret-name");
  });

  it("reports public env secret names at the suspicious name location", () => {
    writeFile(
      "src/client.tsx",
      `export const analytics = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;\nexport const secret = process.env.NEXT_PUBLIC_SECRET_TOKEN;\n`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([
      expect.objectContaining({
        rule: "public-env-secret-name",
        line: 2,
        column: 35,
      }),
    ]);
  });

  it("does not report server-only public env probes as client secret exposure", () => {
    writeFile(
      "src/server/env.server.ts",
      `export const token = process.env.NEXT_PUBLIC_SECRET_TOKEN;`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("keeps tenant CDN fetches in client code quiet", () => {
    writeFile(
      "src/components/avatar.tsx",
      `export const Avatar = ({ org }) => <img src={cdn + "/" + org.slug + "/avatar.png"} />;`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("does not flag CI installs that disable lifecycle scripts before secrets are available", () => {
    writeFile(
      ".github/workflows/test.yml",
      `steps:\n  - run: pnpm install --ignore-scripts\n    env:\n      RELEASE_TOKEN: \${{ secrets.RELEASE_TOKEN }}\n`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("reports source maps that expose server env names even without concrete values", () => {
    writeFile(
      "dist/assets/app.js.map",
      JSON.stringify({
        version: 3,
        sourcesContent: [`export const secret = process.env.DATABASE_URL;`],
      }),
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("artifact-env-leak");
  });

  it("keeps ownership-bound Firebase and Supabase policies quiet", () => {
    writeFile(
      "firestore.rules",
      `service cloud.firestore { match /databases/{database}/documents { match /users/{userId} { allow read, write: if request.auth.uid == userId; } } }`,
    );
    writeFile(
      "supabase/migrations/002.sql",
      `alter table profiles enable row level security; create policy "own profile" on profiles using (auth.uid() = user_id) with check (auth.uid() = user_id);`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("does not treat service_role mentions in SQL comments as an RLS bypass", () => {
    writeFile(
      "supabase/migrations/003_service_role_note.sql",
      `alter table profiles enable row level security;\n-- service_role is intentionally not used in policies below\ncreate policy own_profile on profiles using (auth.uid() = user_id) with check (auth.uid() = user_id);\n`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("still scans high-priority SQL even when many artifact files exist first", () => {
    for (let fileIndex = 0; fileIndex < 2600; fileIndex += 1) {
      writeFile(`public/chunks/chunk-${fileIndex}.js`, `window.chunk${fileIndex} = ${fileIndex};`);
    }
    writeFile(
      "supabase/migrations/999_open_write.sql",
      `create policy "open writes" on documents for all using (true) with check (true);`,
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("supabase-rls-policy-risk");
  });

  it("still scans source files when artifact files fill their own bucket", () => {
    for (let fileIndex = 0; fileIndex < 2600; fileIndex += 1) {
      writeFile(`public/chunks/chunk-${fileIndex}.js`, `window.chunk${fileIndex} = ${fileIndex};`);
    }
    writeFile("src/client.tsx", `export const token = process.env.NEXT_PUBLIC_SECRET_TOKEN;`);

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("public-env-secret-name");
  });

  it("keeps public key blocks quiet while still flagging private key blocks", () => {
    writeFile(
      "keys/public.pem",
      "-----BEGIN PUBLIC KEY-----\nnot-secret-public-material\n-----END PUBLIC KEY-----\n",
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);

    writeFile(
      "keys/private.pem",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKCAQEA39k9udklHnmkU0GtTLpnYtKk1l5txYmUDcGI0bFd3HHOOLG\n-----END RSA PRIVATE KEY-----\n",
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("key-lifecycle-risk");
  });

  it("reports executable SVG embeds but not regular SVG image tags", () => {
    writeFile("src/icon.tsx", `export const Icon = () => <img src="/icon.svg" alt="" />;`);
    expect(checkSecurityScan(temporaryRoot)).toEqual([]);

    writeFile("src/embed.tsx", `export const Embed = () => <object data="/diagram.svg" />;`);
    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("active-static-asset");
  });

  it("keeps exact-origin local bridge checks quiet", () => {
    writeFile(
      "src/local-bridge.ts",
      `if (origin === "https://driverhub.asus.com") new WebSocket("ws://127.0.0.1:53000/status");`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("keeps docs examples out of source-only scanners", () => {
    writeFile(
      "README.md",
      `Install the plugin with npm, then render examples with dangerouslySetInnerHTML in docs.`,
    );
    writeFile(
      "docs/security.md",
      `window.addEventListener("message", (event) => console.log(event.data)); localhost update notes.`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("keeps documentation sample keys quiet", () => {
    writeFile(
      "README.md",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n",
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).not.toContain("key-lifecycle-risk");
  });

  it("keeps generated source examples quiet", () => {
    writeFile(
      "src/generated/icons.ts",
      `// @generated\nexport const icons = ["javascript", "python", "zip", "svg", "import"];`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("still scans top-level public scripts as browser source", () => {
    writeFile(
      "public/widget.js",
      `window.addEventListener("message", (event) => window.dispatchEvent(new CustomEvent("unsafe", { detail: event.data })));`,
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("postmessage-origin-risk");
  });

  it("keeps generated public chunk scripts quiet for source-only scanners", () => {
    writeFile(
      "public/chunks/widget.js",
      `window.addEventListener("message", (event) => window.dispatchEvent(new CustomEvent("unsafe", { detail: event.data })));`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("keeps Vite browser config probes quiet", () => {
    writeFile(
      "vite.config.ts",
      `import react from "@vitejs/plugin-react"; export default { plugins: [react()], define: { BRAVE_BINARY: "browser" } };`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("still reports timing-unsafe signature comparisons", () => {
    writeFile(
      "src/webhook-crypto.ts",
      `if (signature !== expectedSignature) throw new Error("bad");`,
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("insecure-crypto-risk");
  });

  it("keeps placeholder signature comparisons quiet outside security-shaped code", () => {
    writeFile("src/git-status.ts", `if (signature === "0") throw new Error("empty");`);

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("keeps signature string literal comparisons quiet", () => {
    writeFile("src/event-kind.ts", `if (kind === "signature") return "signed";`);

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("keeps gesture origin variable names quiet", () => {
    writeFile(
      "src/gesture.ts",
      `const { origin, distance } = getOriginAndDistance(touches[0], touches[1]); updatePinchState(false);`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("keeps non-Firebase immutable map writes quiet", () => {
    writeFile(
      "src/immutable-map.ts",
      `class ImmutableMap { __ownerID = "owner"; set(key: string, value: string) { return [key, value]; } }`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("still reports Firebase compat writes to authorization fields", () => {
    writeFile(
      "src/firebase-compat.ts",
      `firebase.firestore().collection("documents").doc(id).set({ ownerId: user.uid, role: "admin" });`,
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain(
      "firebase-client-owned-authz-field",
    );
  });

  it("flags secret-like values committed in package metadata", () => {
    expect(
      checkSecurityScan(path.join(FIXTURES_DIRECTORY, "package-metadata-secret-leak")),
    ).toEqual([
      expect.objectContaining({
        rule: "package-metadata-secret",
        filePath: "package.json",
        message: "Package metadata contains secret-like values or public env secret names.",
      }),
    ]);
  });

  it("disables every scan rule when the security-scan tag is ignored", () => {
    expect(
      checkSecurityScan(path.join(FIXTURES_DIRECTORY, "eva-todesktop-release-pipeline"), {
        ignoredTags: new Set(["security-scan"]),
      }),
    ).toEqual([]);
  });

  it("single-sources diagnostic metadata from the registry rule", () => {
    const entry = REACT_DOCTOR_RULES.find(
      (candidate) => candidate.id === "build-pipeline-secret-boundary",
    );
    if (entry === undefined) throw new Error("build-pipeline-secret-boundary not in registry");

    const diagnostics = checkSecurityScan(
      path.join(FIXTURES_DIRECTORY, "eva-todesktop-release-pipeline"),
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      rule: "build-pipeline-secret-boundary",
      title: entry.rule.title,
      help: entry.rule.recommendation,
      severity: entry.rule.severity === "warn" ? "warning" : "error",
    });
  });
});
