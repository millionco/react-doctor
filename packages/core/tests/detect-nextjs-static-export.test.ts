import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { detectNextjsStaticExport } from "../src/project-info/detectors.js";

const temporaryRoots: string[] = [];

const withNextConfig = (filename: string, content: string): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-static-export-"));
  temporaryRoots.push(directory);
  fs.writeFileSync(path.join(directory, filename), content, "utf-8");
  return directory;
};

afterAll(() => {
  for (const directory of temporaryRoots) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("detectNextjsStaticExport", () => {
  it('detects `output: "export"` across quote styles and config variants', () => {
    expect(
      detectNextjsStaticExport(
        withNextConfig("next.config.js", "module.exports = { output: 'export' };\n"),
      ),
    ).toBe(true);
    expect(
      detectNextjsStaticExport(
        withNextConfig(
          "next.config.ts",
          'import type { NextConfig } from "next";\nconst nextConfig: NextConfig = { output: "export", trailingSlash: true };\nexport default nextConfig;\n',
        ),
      ),
    ).toBe(true);
    expect(
      detectNextjsStaticExport(
        withNextConfig("next.config.mjs", 'export default { output: "export" };\n'),
      ),
    ).toBe(true);
  });

  it("returns false for non-export output modes and missing/unrelated config", () => {
    expect(
      detectNextjsStaticExport(
        withNextConfig("next.config.js", "module.exports = { output: 'standalone' };\n"),
      ),
    ).toBe(false);
    expect(
      detectNextjsStaticExport(
        withNextConfig("next.config.js", "module.exports = { reactStrictMode: true };\n"),
      ),
    ).toBe(false);
    expect(detectNextjsStaticExport(fs.mkdtempSync(path.join(os.tmpdir(), "rd-no-config-")))).toBe(
      false,
    );
  });

  it("does not match a namespaced/member key whose name contains `output`", () => {
    expect(
      detectNextjsStaticExport(
        withNextConfig(
          "next.config.js",
          "module.exports = { experimental: { outputFileTracingRoot: 'export' } };\n",
        ),
      ),
    ).toBe(false);
  });
});
