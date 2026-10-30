import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedSupabaseServerClientFactory } from "../../utils/is-imported-supabase-server-client-factory.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

interface FactoryCase {
  readonly name: string;
  readonly supported: boolean;
  readonly consumer?: string;
  readonly provider?: string;
  readonly files?: Readonly<Record<string, string>>;
}

const consumer = `
import useGateway from './client';
import { cookies as readRequestCookies } from 'next/headers';
export async function Page() {
  const jar = readRequestCookies();
  return await useGateway(jar);
}
`;

const provider = `
import { createServerClient as constructClient } from '@supabase/ssr';
export default function makeRequestClient(jar: { get(name: string): { value: string } | undefined }) {
  return constructClient(process.env.SERVICE_URL!, process.env.SERVICE_TOKEN!, {
    cookies: { get(name: string) { return jar.get(name)?.value; } }
  });
}
`;

const expressionProvider = `
import { createServerClient as constructClient } from '@supabase/ssr';
const makeRequestClient = (jar) => constructClient(process.env.SERVICE_URL, process.env.SERVICE_TOKEN, {
  cookies: { get: (name) => jar.get(name)?.value }
});
export default makeRequestClient;
`;

const proofRule: Rule = {
  id: "test-supabase-factory-proof",
  severity: "error",
  create: (context) => ({
    CallExpression: (call: EsTreeNodeOfType<"CallExpression">) => {
      if (isImportedSupabaseServerClientFactory(call, context)) {
        context.report({ node: call.callee, message: "matched finite client factory" });
      }
    },
  }),
};

const cases: readonly FactoryCase[] = [
  { name: "default import and typed cookie method", supported: true },
  {
    name: "expression arrow and fresh arrow adapter",
    supported: true,
    provider: expressionProvider,
  },
  {
    name: "block arrow",
    supported: true,
    provider: provider
      .replace(
        "export default function makeRequestClient(jar: { get(name: string): { value: string } | undefined }) {",
        "const makeRequestClient = (jar) => {",
      )
      .replace(/}\s*$/, "}; export default makeRequestClient;"),
  },
  {
    name: "renamed named export",
    supported: true,
    consumer: consumer.replace("import useGateway", "import { makeRequestClient as useGateway }"),
    provider: provider.replace("export default function", "export function"),
  },
  {
    name: "immediate tsconfig alias",
    supported: true,
    consumer: consumer.replace("'./client'", "'@request/client'"),
    files: { "tsconfig.json": '{"compilerOptions":{"paths":{"@request/*":["./*"]}}}' },
  },
  {
    name: "erased cookie API annotation",
    supported: true,
    provider: provider
      .replace(
        "export default function",
        "import { cookies } from 'next/headers'; export default function",
      )
      .replace(
        "jar: { get(name: string): { value: string } | undefined }",
        "jar: ReturnType<typeof cookies>",
      ),
  },
  {
    name: "erased SDK interface heritage",
    supported: true,
    provider: provider.replace(
      "export default function",
      "interface ClientConstructor extends constructClient {} export default function",
    ),
  },
  {
    name: "other SDK",
    supported: false,
    provider: provider.replace("'@supabase/ssr'", "'other-sdk'"),
  },
  {
    name: "wrong SDK export",
    supported: false,
    provider: provider.replace("createServerClient as", "createBrowserClient as"),
  },
  {
    name: "type-only SDK declaration",
    supported: false,
    provider: provider.replace("import {", "import type {"),
  },
  {
    name: "type-only SDK specifier",
    supported: false,
    provider: provider.replace("{ createServerClient", "{ type createServerClient"),
  },
  {
    name: "SDK namespace",
    supported: false,
    provider: provider
      .replace("{ createServerClient as constructClient }", "* as sdk")
      .replace("return constructClient(", "return sdk.createServerClient("),
  },
  {
    name: "SDK local alias",
    supported: false,
    provider: provider.replace(
      "return constructClient(",
      "const make = constructClient; return make(",
    ),
  },
  {
    name: "SDK runtime extra use",
    supported: false,
    provider: provider + "export { constructClient };",
  },
  {
    name: "provider initialization effect",
    supported: false,
    provider: provider + "initializeSession();",
  },
  {
    name: "provider runtime enum",
    supported: false,
    provider: provider + "enum Mode { Active = initializeSession() }",
  },
  {
    name: "provider unrelated function",
    supported: false,
    provider: provider + "function initialize() { mutateSdk(); }",
  },
  {
    name: "provider parameter default",
    supported: false,
    provider: provider.replace(
      "jar: { get(name: string): { value: string } | undefined }",
      "jar = useState(0)",
    ),
  },
  {
    name: "provider async",
    supported: false,
    provider: provider.replace("default function", "default async function"),
  },
  {
    name: "provider generator",
    supported: false,
    provider: provider.replace("function make", "function* make"),
  },
  {
    name: "provider extra body effect",
    supported: false,
    provider:
      "import { useState } from 'react';" +
      provider.replace("return constructClient", "useState(0); return constructClient"),
  },
  {
    name: "provider recursive escape",
    supported: false,
    provider: provider.replace("return constructClient", "return makeRequestClient"),
  },
  {
    name: "extra SDK config argument",
    supported: false,
    provider: provider.replace("  });", "  }, useState(0));"),
  },
  {
    name: "call-valued environment",
    supported: false,
    provider: provider.replace("process.env.SERVICE_URL!", "useState(0)"),
  },
  {
    name: "shadowed process",
    supported: false,
    provider: provider.replace("import {", "import process from './process'; import {"),
  },
  {
    name: "extra adapter callback",
    supported: false,
    provider: provider.replace(
      "cookies: { get",
      "onAuthStateChange: () => useState(0), cookies: { get",
    ),
  },
  {
    name: "duplicate cookies key",
    supported: false,
    provider: provider.replace("cookies: { get", "cookies: useState(0), cookies: { get"),
  },
  {
    name: "spread options",
    supported: false,
    provider: provider.replace("cookies: { get", "...configuration, cookies: { get"),
  },
  {
    name: "computed cookie key",
    supported: false,
    provider: provider.replace("cookies: {", "['cookies']: {"),
  },
  {
    name: "cookie getter property",
    supported: false,
    provider: provider.replace("get(name: string) {", "get get() { const name = 'session';"),
  },
  {
    name: "adapter default effect",
    supported: false,
    provider:
      "import { useState } from 'react';" +
      provider.replace("get(name: string) {", "get(name = useState(0)) {"),
  },
  {
    name: "adapter async",
    supported: false,
    provider: provider.replace("get(name: string) {", "async get(name: string) {"),
  },
  {
    name: "adapter different name",
    supported: false,
    provider: provider.replace("jar.get(name)", "jar.get('session')"),
  },
  {
    name: "adapter different receiver",
    supported: false,
    provider: provider.replace("jar.get(name)", "otherJar.get(name)"),
  },
  {
    name: "adapter extra effect",
    supported: false,
    provider: provider.replace("return jar.get", "useState(0); return jar.get"),
  },
  {
    name: "nonoptional cookie record",
    supported: false,
    provider: provider.replace("?.value", ".value"),
  },
  {
    name: "mutable wrapper export",
    supported: false,
    provider: expressionProvider.replace("const makeRequestClient", "let makeRequestClient"),
  },
  {
    name: "barrel",
    supported: false,
    provider: "export { default } from './implementation';",
    files: { "implementation.ts": provider },
  },
  {
    name: "arbitrary cookie factory",
    supported: false,
    consumer: consumer.replace("const jar = readRequestCookies()", "const jar = makeJar()"),
  },
  {
    name: "cookie import namespace",
    supported: false,
    consumer: consumer
      .replace("{ cookies as readRequestCookies }", "* as request")
      .replace("readRequestCookies()", "request.cookies()"),
  },
  {
    name: "type-only cookies",
    supported: false,
    consumer: consumer.replace("import { cookies", "import type { cookies"),
  },
  {
    name: "awaited cookie result",
    supported: false,
    consumer: consumer.replace(
      "const jar = readRequestCookies()",
      "const jar = await readRequestCookies()",
    ),
  },
  {
    name: "cookie result escape",
    supported: false,
    consumer: consumer.replace("return await", "consume(jar); return await"),
  },
  {
    name: "cookie method replacement",
    supported: false,
    consumer: consumer.replace(
      "return await",
      "jar.get = () => ({ value: useState(0) }); return await",
    ),
  },
  {
    name: "cookie runtime catch-default escape",
    supported: false,
    consumer: consumer.replace(
      "return await",
      "try {} catch ({ missing = consume(jar) }) {} return await",
    ),
  },
  {
    name: "exported cookie object",
    supported: false,
    consumer: consumer.replace(
      "export async function Page() {\n  const jar = readRequestCookies();",
      "export const jar = readRequestCookies(); export async function Page() {",
    ),
  },
  {
    name: "wrapper namespace",
    supported: false,
    consumer: consumer
      .replace("import useGateway", "import * as Gateway")
      .replace("useGateway(jar)", "Gateway.useGateway(jar)"),
  },
  {
    name: "wrapper type import",
    supported: false,
    consumer: consumer.replace("import useGateway", "import type useGateway"),
  },
  {
    name: "wrapper extra argument",
    supported: false,
    consumer: consumer.replace("useGateway(jar)", "useGateway(jar, configuration)"),
  },
  {
    name: "wrapper exported alias",
    supported: false,
    consumer: consumer + "export { useGateway };",
  },
  {
    name: "locally resolved SDK replacement",
    supported: false,
    files: {
      "tsconfig.json": '{"compilerOptions":{"paths":{"@supabase/ssr":["./fake-sdk"]}}}',
      "fake-sdk.ts": "export const createServerClient = () => useState(0);",
    },
  },
  {
    name: "locally resolved Next replacement",
    supported: false,
    files: {
      "tsconfig.json": '{"compilerOptions":{"paths":{"next/headers":["./fake-headers"]}}}',
      "fake-headers.ts": "export const cookies = () => ({ get: () => useState(0) });",
    },
  },
  {
    name: "direct eval replaces private cookie getter",
    supported: false,
    consumer: consumer
      .replace("import useGateway", "import { useState } from 'react'; import useGateway")
      .replace("return await", 'eval("jar.get = () => ({ value: useState(0) })"); return await'),
  },
];

for (const {
  name,
  supported,
  consumer: caseConsumer = consumer,
  provider: caseProvider = provider,
  files = {},
} of cases) {
  describe(name, () => {
    it("checks the whole call certificate and preserves parser errors", () => {
      const directory = mkdtempSync(join(tmpdir(), "ssr-client-role-"));
      try {
        for (const [relative, contents] of Object.entries({
          "client.ts": caseProvider,
          ...files,
        })) {
          const filename = join(directory, relative);
          mkdirSync(dirname(filename), { recursive: true });
          writeFileSync(filename, contents);
        }
        expect(
          parseFixture(caseProvider, { filename: join(directory, "client.ts") }).errors,
        ).toEqual([]);
        const filename = join(directory, "page.tsx");
        writeFileSync(filename, caseConsumer);
        resetFilesystemCaches();
        const certificate = runRule(proofRule, caseConsumer, { filename });
        expect(certificate.parseErrors).toEqual([]);
        expect(certificate.diagnostics).toHaveLength(Number(supported));
        for (const rule of [rulesOfHooks, wrapWithSemanticContext(rulesOfHooks)]) {
          const result = runRule(rule, caseConsumer, { filename });
          expect(result.parseErrors).toEqual([]);
          const selected = result.diagnostics.filter((diagnostic) =>
            diagnostic.message.startsWith("`useGateway`"),
          );
          expect(selected).toHaveLength(Number(!supported));
          if (supported) expect(result.diagnostics).toEqual([]);
        }
      } finally {
        resetFilesystemCaches();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
}
