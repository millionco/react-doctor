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
}

interface ScanParityFixtureInput {
  readonly name: string;
  readonly relativePath: string;
  readonly content: string;
  readonly isGeneratedBundle?: boolean;
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

const REGRESSION_FIXTURE_INPUTS: ReadonlyArray<ScanParityFixtureInput> = [
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
  typeof value.scanReactDoctorFile === "function";

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
          if (findings.length > 0) {
            firingFixtureCountByRule.set(ruleId, (firingFixtureCountByRule.get(ruleId) ?? 0) + 1);
          }
          return [ruleId, normalizeJson(findings)];
        }),
      );
      const nativeOutputJson = binding.scanReactDoctorFile(
        JSON.stringify({ ...scannedFile, ruleIds: RETAINED_SCAN_RULE_IDS }),
      );
      assert.equal(
        typeof nativeOutputJson,
        "string",
        `${fixture.name}: native scan output must be JSON text`,
      );
      const nativeFindingsByRule: unknown = JSON.parse(nativeOutputJson);
      try {
        assert.deepEqual(
          nativeFindingsByRule,
          canonicalFindingsByRule,
          `${fixture.name} (${fixture.relativePath})`,
        );
      } catch (error) {
        parityDifferences.push(error instanceof Error ? error.message : String(error));
      }
    }

    for (const [ruleId, firingFixtureCount] of firingFixtureCountByRule) {
      assert.ok(firingFixtureCount > 0, `${ruleId} has no firing parity fixture`);
    }
    if (parityDifferences.length > 0) {
      throw new Error(
        `Native scan parity found ${parityDifferences.length} mismatched fixtures:\n\n${parityDifferences.join("\n\n")}`,
      );
    }
    process.stdout.write(
      `Native scan parity passed: ${RETAINED_SCAN_RULE_IDS.length} rules, ${fixtures.length} fixtures.\n`,
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

run();
