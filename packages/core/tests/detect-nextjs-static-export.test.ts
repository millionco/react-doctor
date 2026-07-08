import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { detectNextjsStaticExport } from "../src/project-info/detect-nextjs-static-export.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-detect-nextjs-static-export-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupProject = (caseId: string, files: Record<string, string>): string => {
  const projectDirectory = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDirectory, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(projectDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return projectDirectory;
};

describe("detectNextjsStaticExport", () => {
  it("detects output: 'export' in next.config.ts", () => {
    const projectDirectory = setupProject("ts-export", {
      "next.config.ts":
        "import type { NextConfig } from 'next';\nconst nextConfig: NextConfig = { output: 'export' };\nexport default nextConfig;\n",
    });

    expect(detectNextjsStaticExport(projectDirectory)).toBe(true);
  });

  it('detects output: "export" in next.config.js', () => {
    const projectDirectory = setupProject("js-export", {
      "next.config.js": 'module.exports = { output: "export" };\n',
    });

    expect(detectNextjsStaticExport(projectDirectory)).toBe(true);
  });

  it("does not detect standalone output: 'standalone'", () => {
    const projectDirectory = setupProject("standalone", {
      "next.config.mjs": "export default { output: 'standalone' };\n",
    });

    expect(detectNextjsStaticExport(projectDirectory)).toBe(false);
  });

  it("does not detect when output is absent", () => {
    const projectDirectory = setupProject("absent", {
      "next.config.cjs": "module.exports = {};\n",
    });

    expect(detectNextjsStaticExport(projectDirectory)).toBe(false);
  });
});
