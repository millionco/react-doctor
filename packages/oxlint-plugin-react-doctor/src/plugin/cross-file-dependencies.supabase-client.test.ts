import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { collectCrossFileDependencyProbes } from "./cross-file-dependencies.js";
import { resetFilesystemCaches } from "./utils/reset-filesystem-caches.js";

const source = `
import useGateway from '@request/client';
import { cookies } from 'next/headers';
export async function Page() { const jar = cookies(); return await useGateway(jar); }
`;
const provider = `
import { createServerClient } from '@supabase/ssr';
export default function makeClient(jar) {
  return createServerClient(process.env.SERVICE_URL, process.env.SERVICE_TOKEN, {
    cookies: { get(name) { return jar.get(name)?.value; } }
  });
}
`;

const configurations = [
  {
    name: "alias provider and negative bare-package candidates",
    providerPresent: true,
    configuration: { compilerOptions: { paths: { "@request/*": ["./*"] } } },
  },
  {
    name: "missing alias provider candidates",
    providerPresent: false,
    configuration: { compilerOptions: { paths: { "@request/*": ["./*"] } } },
  },
  {
    name: "local SDK replacement veto",
    providerPresent: true,
    configuration: {
      compilerOptions: {
        paths: {
          "@request/*": ["./*"],
          "@supabase/ssr": ["./fake-sdk"],
        },
      },
    },
  },
];

describe.each(configurations)("$name", ({ providerPresent, configuration }) => {
  it("records the same positive and negative resolution facts as the call proof", () => {
    const directory = mkdtempSync(join(tmpdir(), "ssr-client-probes-"));
    try {
      const write = (relative: string, contents: string) => {
        const filename = join(directory, relative);
        mkdirSync(dirname(filename), { recursive: true });
        writeFileSync(filename, contents);
        return filename;
      };
      const filename = write("page.tsx", source);
      const configPath = write("tsconfig.json", JSON.stringify(configuration));
      const sdkPath = write("fake-sdk.ts", "export const createServerClient = () => useState(0);");
      const providerPath = join(directory, "client.ts");
      if (providerPresent) write("client.ts", provider);
      resetFilesystemCaches();
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: source,
        ruleIds: ["rules-of-hooks"],
      });
      expect(trace).not.toBeNull();
      expect(trace?.contentPaths.has(configPath)).toBe(true);
      expect(trace?.existencePaths.has(providerPath)).toBe(true);
      expect(trace?.contentPaths.has(providerPath)).toBe(providerPresent);
      if ("@supabase/ssr" in configuration.compilerOptions.paths) {
        expect(trace?.existencePaths.has(sdkPath)).toBe(true);
      }
    } finally {
      resetFilesystemCaches();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
