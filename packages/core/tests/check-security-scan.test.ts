import { spawnSync } from "node:child_process";
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

const setOrDeleteEnv = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

let originalGitConfigGlobal: string | undefined;
let originalGitConfigSystem: string | undefined;

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-security-scan-"));
  // Hermetic git: a runner's ambient global/system config (e.g. a
  // `core.excludesFile` that ignores `.env`) must not change `check-ignore`'s
  // verdict — both the test's `git init` and the scan's internal
  // `git check-ignore` inherit this env, so the committed-file gitignore tests
  // stay deterministic regardless of the host's git setup.
  originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  originalGitConfigSystem = process.env.GIT_CONFIG_SYSTEM;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
});

afterEach(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  setOrDeleteEnv("GIT_CONFIG_GLOBAL", originalGitConfigGlobal);
  setOrDeleteEnv("GIT_CONFIG_SYSTEM", originalGitConfigSystem);
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

    it("keeps a Sanity studio browser chunk quiet (its createClient/projectId is not BaaS config)", () => {
      expect(
        checkSecurityScan(path.join(FIXTURES_DIRECTORY, "real-sanity-studio-browser-bundle")),
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

  describe("supabase-table-missing-rls", () => {
    it("flags a vibe-coded Supabase migration that creates a public table without RLS", () => {
      expect(fixtureRules("supabase-public-table-missing-rls")).toEqual(
        new Set(["supabase-table-missing-rls"]),
      );
    });

    it("flags an unqualified public create table, then goes quiet once RLS is enabled", () => {
      writeFile(
        "supabase/migrations/001_create_todos.sql",
        `create table todos (\n  id uuid primary key,\n  user_id uuid not null,\n  title text\n);\n`,
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("supabase-table-missing-rls");

      writeFile(
        "supabase/migrations/001_create_todos.sql",
        `create table todos (\n  id uuid primary key,\n  user_id uuid not null\n);\nalter table todos enable row level security;\ncreate policy own_todos on todos using (auth.uid() = user_id);\n`,
      );
      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag create table in non-public, Supabase-managed schemas", () => {
      writeFile(
        "supabase/migrations/002_internal.sql",
        `create table auth.audit_log (id uuid primary key, event text);\ncreate table private.secrets (id uuid primary key, value text);\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag plain SQL migrations outside the supabase directory", () => {
      writeFile(
        "drizzle/0000_init.sql",
        `create table users (\n  id serial primary key,\n  email text not null\n);\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag a create table that appears only inside a SQL comment", () => {
      writeFile(
        "supabase/migrations/003_notes.sql",
        `-- create table audit_log later when we add logging\nselect now();\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag a commented-out create table statement", () => {
      writeFile(
        "supabase/migrations/005_commented.sql",
        `-- create table legacy_users (id uuid primary key);\n/* create table old_logs (id uuid primary key); */\ncreate table active_users (id uuid primary key);\nalter table active_users enable row level security;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag a create table that appears only inside a string literal", () => {
      writeFile(
        "supabase/migrations/006_seed.sql",
        `create table notes (id uuid primary key, body text);\nalter table notes enable row level security;\ninsert into notes (body) values ('create table fake (id int);');\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag create table inside a dollar-quoted string value", () => {
      writeFile(
        "supabase/migrations/010_doc.sql",
        `create table guides (id uuid primary key);\nalter table guides enable row level security;\ninsert into guides (body) values ($doc$ example: create table demo (id int); $doc$);\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("stays quiet when RLS is enabled inside a DO block", () => {
      writeFile(
        "supabase/migrations/009_do_block.sql",
        `create table reports (id uuid primary key);\ndo $$ begin\n  alter table reports enable row level security;\nend $$;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag create table text inside a DO block string", () => {
      writeFile(
        "supabase/migrations/013_do_string.sql",
        `create table invoices (id uuid primary key);\nalter table invoices enable row level security;\ndo $$ begin\n  raise notice 'create table example (id int)';\nend $$;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag a create table comment inside a DO block", () => {
      writeFile(
        "supabase/migrations/012_do_comment.sql",
        `create table sales (id uuid primary key);\nalter table sales enable row level security;\ndo $$ begin\n  -- create table legacy (id int);\n  perform 1;\nend $$;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("stays quiet when RLS is enabled inside a DO LANGUAGE block", () => {
      writeFile(
        "supabase/migrations/014_do_language.sql",
        `create table audits (id uuid primary key);\ndo language plpgsql $$ begin\n  alter table audits enable row level security;\nend $$;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("recognizes a DO LANGUAGE plpython3u block (digit in language name) as a code body", () => {
      writeFile(
        "supabase/migrations/017_plpython.sql",
        `create table metrics (id uuid primary key);\ndo language plpython3u $$\nalter table metrics enable row level security;\n$$;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("stays quiet when RLS is enabled via a dynamic EXECUTE in a DO block", () => {
      writeFile(
        "supabase/migrations/011_dynamic.sql",
        `create table ledgers (id uuid primary key);\ndo $$ begin\n  execute 'alter table ledgers enable row level security';\nend $$;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("stays quiet when RLS is enabled via EXECUTE format in a DO block", () => {
      writeFile(
        "supabase/migrations/015_execute_format.sql",
        `create table tickets (id uuid primary key);\ndo $$ begin\n  execute format('alter table tickets enable row level security');\nend $$;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("flags a table whose RLS enable only appears inside a PERFORM string (not executed)", () => {
      writeFile(
        "supabase/migrations/018_perform_rls.sql",
        `create table balances (id uuid primary key);\ndo $$ begin\n  perform 'alter table balances enable row level security';\nend $$;\n`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("supabase-table-missing-rls");
    });

    it("does not flag a create table that appears only inside a PERFORM string", () => {
      writeFile(
        "supabase/migrations/019_perform_create.sql",
        `create table accounts (id uuid primary key);\nalter table accounts enable row level security;\ndo $$ begin\n  perform 'create table shadow (id int)';\nend $$;\n`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("flags a table whose RLS enable is only inside a function body", () => {
      writeFile(
        "supabase/migrations/016_func.sql",
        `create table widgets2 (id uuid primary key);\ncreate function enable_rls() returns void language plpgsql as $$ begin\n  alter table widgets2 enable row level security;\nend $$;\n`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("supabase-table-missing-rls");
    });

    it("flags a table when enable RLS appears before the create", () => {
      writeFile(
        "supabase/migrations/008_order.sql",
        `alter table if exists widgets enable row level security;\ncreate table widgets (id uuid primary key);\n`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("supabase-table-missing-rls");
    });

    it("flags only the table missing RLS in a multi-table migration", () => {
      writeFile(
        "supabase/migrations/004_two_tables.sql",
        `create table profiles (id uuid primary key);\nalter table profiles enable row level security;\ncreate table audit_log (id uuid primary key, event text);\n`,
      );

      const tableMissingRlsFindings = checkSecurityScan(temporaryRoot).filter(
        (diagnostic) => diagnostic.rule === "supabase-table-missing-rls",
      );
      expect(tableMissingRlsFindings).toHaveLength(1);
      expect(tableMissingRlsFindings[0]?.line).toBe(3);
    });
  });

  describe("unsafe-json-in-html", () => {
    it("flags JSON.stringify embedded in dangerouslySetInnerHTML and in <script> markup", () => {
      writeFile(
        "src/hydrate.tsx",
        `export const Hydrate = ({ data }) => <div dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;`,
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("unsafe-json-in-html");

      writeFile(
        "src/ssr.ts",
        "export const shell = (state) => `<script>window.__DATA__ = ${JSON.stringify(state)}</script>`;",
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("unsafe-json-in-html");
    });

    it("stays quiet when the JSON.stringify result is escaped inline", () => {
      writeFile(
        "src/hydrate-safe.tsx",
        'export const H = ({ data }) => <div dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "&lt;") }} />;',
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("stays quiet when the escaped stringify call is wrapped in parentheses", () => {
      writeFile(
        "src/paren-hydrate.tsx",
        'export const H = ({ data }) => <div dangerouslySetInnerHTML={{ __html: (JSON.stringify(data)).replace(/</g, "&lt;") }} />;',
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("still flags an unescaped sink when a safe serializer is only imported elsewhere", () => {
      writeFile(
        "src/mixed-hydrate.tsx",
        'import serialize from "serialize-javascript";\nexport const safe = (s) => serialize(s);\nexport const Bad = ({ data }) => <div dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;',
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("unsafe-json-in-html");
    });

    it("stays quiet when JSON.stringify is wrapped in an escape helper", () => {
      writeFile(
        "src/wrapped.tsx",
        "export const H = ({ data }) => <div dangerouslySetInnerHTML={{ __html: escapeHtml(JSON.stringify(data)) }} />;",
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("stays quiet when JSON.stringify is wrapped in devalue", () => {
      writeFile(
        "src/devalue-hydrate.tsx",
        'import { uneval } from "devalue";\nexport const H = ({ data }) => <script dangerouslySetInnerHTML={{ __html: uneval(JSON.stringify(data)) }} />;',
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("still flags when an unrelated .serialize() method wraps the call", () => {
      writeFile(
        "src/serialize-method.tsx",
        "export const H = ({ obj, data }) => <div dangerouslySetInnerHTML={{ __html: obj.serialize(JSON.stringify(data)) }} />;",
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("unsafe-json-in-html");
    });

    it("still flags when an escape helper is applied to the input, not the output", () => {
      writeFile(
        "src/preprocess.tsx",
        "export const H = ({ data }) => <div dangerouslySetInnerHTML={{ __html: JSON.stringify(escapeHtml(data)) }} />;",
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("unsafe-json-in-html");
    });
  });

  describe("jwt-insecure-verification", () => {
    it("flags the JWT 'none' algorithm in verify and sign options", () => {
      writeFile(
        "src/jwt-none.ts",
        `import jwt from "jsonwebtoken";\nexport const v = (t, k) => jwt.verify(t, k, { algorithms: ["none"] });`,
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("jwt-insecure-verification");

      writeFile(
        "src/jwt-sign-none.ts",
        `import jwt from "jsonwebtoken";\nexport const sign = (payload, key) => jwt.sign(payload, key, { algorithm: "none" });`,
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("jwt-insecure-verification");
    });

    it("flags a JWT none algorithm inside a template expression", () => {
      writeFile(
        "src/jwt-template.ts",
        'import jwt from "jsonwebtoken";\nexport const build = () => `verify: ${JSON.stringify({ alg: "none" })}`;',
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("jwt-insecure-verification");
    });

    it("flags a JOSE-style alg: none header", () => {
      writeFile(
        "src/jose-none.ts",
        `import * as jose from "jose";\nexport const protectedHeader = { alg: "none" };\nexport const lib = jose;`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("jwt-insecure-verification");
    });

    it("does not flag the 'none' algorithm mentioned inside a string literal", () => {
      writeFile(
        "src/jwt-doc.ts",
        `import jwt from "jsonwebtoken";\nexport const warning = "never set algorithm: 'none' in production";\nexport const v = (t, k) => jwt.verify(t, k, { algorithms: ["RS256"] });`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("stays quiet for pinned algorithms and for verify calls in any options shape", () => {
      // The rule deliberately does not flag unpinned verify (it cannot resolve
      // the options binding precisely); only `none` is reported. So an inline
      // pin, an options variable, and a callback form all stay quiet.
      writeFile(
        "src/jwt-ok.ts",
        `import jwt from "jsonwebtoken";\nexport const v = (t, k) => jwt.verify(t, k, { algorithms: ["RS256"] });`,
      );
      writeFile(
        "src/jwt-opts-var.ts",
        `import jwt from "jsonwebtoken";\nconst options = { issuer: "x" };\nexport const v = (t, k) => jwt.verify(t, k, options);`,
      );
      writeFile(
        "src/jwt-callback.ts",
        `import jwt from "jsonwebtoken";\nexport const v = (t, k, cb) => jwt.verify(t, k, cb);`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });
  });

  describe("secret-in-fallback", () => {
    it("flags a secret env var with a hardcoded string fallback", () => {
      writeFile(
        "src/config.ts",
        `export const key = process.env.STRIPE_SECRET_KEY ?? "hardcoded-fallback-secret-value";`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("secret-in-fallback");
    });

    it("stays quiet for placeholder fallbacks and public keys", () => {
      writeFile(
        "src/config-ok.ts",
        `export const apiKey = process.env.API_KEY ?? "your_api_key_here";\nexport const anon = process.env.NEXT_PUBLIC_ANON_KEY ?? "sb_publishable_abcdefghij";`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("stays quiet for secret-referencing names that hold config, not the secret", () => {
      writeFile(
        "src/config-refs.ts",
        [
          `export const header = process.env.AUTH_TOKEN_HEADER ?? "authorization";`,
          `export const endpoint = process.env.TOKEN_ENDPOINT ?? "https://auth.example.com/token";`,
          `export const keyId = process.env.AWS_ACCESS_KEY_ID ?? "AKIAIOSFODNN7ABCDEFG";`,
        ].join("\n"),
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });
  });

  describe("request-body-mass-assignment", () => {
    it("flags spreading and merging request input without an allowlist", () => {
      writeFile(
        "src/create-user.ts",
        `export const create = (req, res) => db.insert(users).values({ ...req.body });`,
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("request-body-mass-assignment");

      writeFile(
        "src/merge-config.ts",
        `export const apply = (req, target) => Object.assign(target, req.body);`,
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("request-body-mass-assignment");
    });

    it("flags a request spread that is not the first property", () => {
      writeFile(
        "src/create-user-trailing.ts",
        `export const create = (req) => db.insert(users).values({ title: req.body.title, ...req.body });`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("request-body-mass-assignment");
    });

    it("stays quiet when explicit fields are assigned", () => {
      writeFile(
        "src/create-user-ok.ts",
        `export const create = (req, res) => db.insert(users).values({ title: req.body.title, ownerId: res.locals.userId });`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });
  });

  describe("insecure-session-cookie", () => {
    it("flags httpOnly:false, document.cookie auth writes, and bare cookie sets", () => {
      writeFile(
        "src/auth.ts",
        `export const set = (res, token) => res.cookie("session", token, { httpOnly: false });`,
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("insecure-session-cookie");

      writeFile(
        "src/client-auth.ts",
        "export const save = (token) => { document.cookie = `access_token=${token}; path=/`; };",
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("insecure-session-cookie");

      writeFile(
        "src/login.ts",
        `export const login = (res, token) => res.cookie("auth_token", token);`,
      );
      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("insecure-session-cookie");
    });

    it("stays quiet for hardened cookies", () => {
      writeFile(
        "src/auth-ok.ts",
        `export const set = (res, token) =>\n  res.cookie("session", token, { httpOnly: true, secure: true, sameSite: "lax" });`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("flags a Next.js response.cookies.set auth cookie without options", () => {
      writeFile(
        "src/next-cookie.ts",
        `export const GET = (response, token) => response.cookies.set("session", token);`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("insecure-session-cookie");
    });

    it("flags httpOnly:false even when it sits late in a long options object", () => {
      writeFile(
        "src/long-cookie.ts",
        `export const set = (res, token) =>\n  res.cookie("session", token, { path: "/", domain: "app.example.com", maxAge: 3_600_000, sameSite: "lax", secure: true, signed: true, encode: String, httpOnly: false });`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("insecure-session-cookie");
    });

    it("does not flag a hardened cookie when 'httpOnly: false' appears in a string value", () => {
      writeFile(
        "src/note-cookie.ts",
        `export const set = (res, token) =>\n  res.cookie("session", token, { httpOnly: true, note: "never set httpOnly: false here" });`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag a hardened cookies().set call", () => {
      writeFile(
        "src/headers-cookie.ts",
        `export const setSession = (token) =>\n  cookies().set("session", token, { httpOnly: true, secure: true, sameSite: "lax" });`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag non-auth cookie names that merely start with an auth keyword", () => {
      writeFile(
        "src/ui-cookies.ts",
        `export const a = (res) => res.cookie("sidebar", "open");\nexport const b = (res) => res.cookie("author", "jane");`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("flags a session middleware cookie config that disables httpOnly", () => {
      writeFile(
        "src/session-insecure.ts",
        `export const config = session({ cookie: { httpOnly: false } });`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("insecure-session-cookie");
    });

    it("flags a cookie config with httpOnly:false after a nested object", () => {
      writeFile(
        "src/session-nested.ts",
        `export const config = session({ cookie: { store: { ttl: 60 }, httpOnly: false } });`,
      );

      expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("insecure-session-cookie");
    });

    it("does not flag a cookie config when 'httpOnly: false' is only in a string", () => {
      writeFile(
        "src/session-config.ts",
        `export const config = session({ cookie: { httpOnly: true, comment: "never use httpOnly: false" } });`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag a non-auth cookie that disables httpOnly", () => {
      writeFile(
        "src/theme-cookie.ts",
        `export const set = (res) => res.cookie("theme", "dark", { httpOnly: false });`,
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
    });

    it("does not flag CSRF/XSRF double-submit cookies, which must be JS-readable", () => {
      writeFile(
        "src/csrf-cookie.ts",
        [
          `export const a = (res, t) => res.cookie("XSRF-TOKEN", t);`,
          `export const b = (t) => cookies().set("csrf-token", t);`,
          `export const c = (t) => { document.cookie = \`csrf-token=\${t}; path=/\`; };`,
        ].join("\n"),
      );

      expect(checkSecurityScan(temporaryRoot)).toEqual([]);
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

  it("does not treat .next/dev/server dev source maps as browser artifacts", () => {
    writeFile(
      ".next/dev/server/chunks/ssr.js.map",
      `window.__ENV__ = { AWS_SECRET_ACCESS_KEY: "x", AWS_ACCESS_KEY_ID: "AKIAABCDEFGHIJKLMNOP" };`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("does not treat dev-mode .next/dev output as a browser artifact", () => {
    writeFile(".next/dev/static/chunks/app.js", `const key = "AKIAABCDEFGHIJKLMNOP";`);

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("still reports secrets in production .next/static output", () => {
    writeFile(".next/static/chunks/app.js", `const key = "AKIAABCDEFGHIJKLMNOP";`);

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("artifact-secret-leak");
  });

  // A `server` segment only marks server build output DIRECTLY under the build
  // root. A production client bundle for an App Router route literally named
  // `server` lives under `.next/static/.../server/` and must still be scanned.
  it("still reports secrets in a .next/static client bundle under a route named 'server'", () => {
    writeFile(".next/static/chunks/app/server/page.js", `const key = "AKIAABCDEFGHIJKLMNOP";`);

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("artifact-secret-leak");
  });

  it("does not flag production .next/server build output", () => {
    writeFile(".next/server/chunks/route.js", `const key = "AKIAABCDEFGHIJKLMNOP";`);

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("does not flag a webhook handler that delegates to an extracted verification helper", () => {
    writeFile(
      "app/api/webhook/route.ts",
      `import { isValidSecret } from "./verify";\nexport const POST = async (request) => {\n  const token = request.headers.get("x-webhook-token");\n  if (!isValidSecret(token, process.env.PROVIDER_SECRET)) return new Response("no", { status: 401 });\n  const event = await request.json();\n  return Response.json({ ok: event.type });\n};`,
    );

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("still flags a webhook handler with no verification at all", () => {
    writeFile(
      "app/api/webhook-bare/route.ts",
      `export const POST = async (request) => {\n  const event = await request.json();\n  return Response.json({ ok: event.type });\n};`,
    );

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("webhook-signature-risk");
  });

  // ReDoS guard for the webhook verification regex (verb run + noun run +
  // trailing run). A regression to unbounded `[A-Za-z]*` makes it backtrack
  // cubically on a long identifier-like run with no closing `(` — minutes on
  // this input. The rule's scan is invoked in isolation (not the whole-tree
  // walk) so the assertion is about the regex, not machine-dependent scan
  // overhead: the bounded `{0,40}` runs finish in well under a millisecond.
  it("webhook-signature-risk scan stays linear on a pathological identifier run", () => {
    const webhookEntry = REACT_DOCTOR_RULES.find((entry) => entry.id === "webhook-signature-risk");
    const scan = webhookEntry?.rule.scan;
    if (!scan) throw new Error("webhook-signature-risk must define a scan");

    const content = `export async function POST(request) {\n  const ${"valid".repeat(5_000)} = 1;\n  const event = await request.json();\n  return Response.json({ ok: event.type });\n}\n`;
    const startedAt = Date.now();
    const findings = scan({
      absolutePath: path.join(temporaryRoot, "app/api/webhook/route.ts"),
      relativePath: "app/api/webhook/route.ts",
      content,
      isGeneratedBundle: false,
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(findings).toHaveLength(1);
  });

  it("does not flag a gitignored env file (not checked into the repository)", () => {
    spawnSync("git", ["init"], { cwd: temporaryRoot, stdio: "ignore" });
    writeFile(".gitignore", ".env\n");
    writeFile(".env", "NEXT_PUBLIC_API_SECRET=local-only-value\n");

    expect(checkSecurityScan(temporaryRoot)).toEqual([]);
  });

  it("flags a non-gitignored env file checked into the repository", () => {
    spawnSync("git", ["init"], { cwd: temporaryRoot, stdio: "ignore" });
    writeFile(".env", "NEXT_PUBLIC_API_SECRET=committed-value\n");

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("repository-secret-file");
  });

  // A force-added file is tracked, so `git check-ignore` reports it as NOT
  // ignored (the index takes precedence over a matching ignore rule) — the
  // committed secret must still be flagged.
  it("flags a force-added env file even when a .gitignore rule matches it", () => {
    spawnSync("git", ["init"], { cwd: temporaryRoot, stdio: "ignore" });
    writeFile(".gitignore", ".env\n");
    writeFile(".env", "NEXT_PUBLIC_API_SECRET=committed-value\n");
    spawnSync("git", ["add", "-f", ".env"], { cwd: temporaryRoot, stdio: "ignore" });

    expect(rulesOf(checkSecurityScan(temporaryRoot))).toContain("repository-secret-file");
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
