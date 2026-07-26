import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { detectReactCompiler } from "../../src/project-info/detectors.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-stack-overflow-1460-"));

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

const writePkg = (content: unknown): string => JSON.stringify(content, null, 2);

describe("issue #1460: detectReactCompiler should not stack overflow on circular references", () => {
  it("handles deeply nested parenthesized expressions without stack overflow", () => {
    const projectDirectory = setupProject("deeply-nested-parens", {
      "package.json": writePkg({ name: "test", version: "1.0.0", dependencies: {} }),
      "vite.config.js": `
        export default {
          plugins: [
            ((((((((((((((((((((
              "some-plugin"
            ))))))))))))))))))))
          ]
        }
      `,
    });

    expect(() => detectReactCompiler(projectDirectory, {})).not.toThrow();
  });

  it("handles circular object spread patterns without stack overflow", () => {
    const projectDirectory = setupProject("circular-spread", {
      "package.json": writePkg({ name: "test", version: "1.0.0", dependencies: {} }),
      "vite.config.js": `
        const a = { ...b, value: 1 };
        const b = { ...a, value: 2 };
        export default {
          plugins: [a]
        }
      `,
    });

    expect(() => detectReactCompiler(projectDirectory, {})).not.toThrow();
  });

  it("handles self-referential conditional expressions without stack overflow", () => {
    const projectDirectory = setupProject("self-referential-conditional", {
      "package.json": writePkg({ name: "test", version: "1.0.0", dependencies: {} }),
      "vite.config.js": `
        const config = config ? config : { plugins: [] };
        export default config;
      `,
    });

    expect(() => detectReactCompiler(projectDirectory, {})).not.toThrow();
  });

  it("handles complex nested binary expressions without stack overflow", () => {
    const projectDirectory = setupProject("nested-binary", {
      "package.json": writePkg({ name: "test", version: "1.0.0", dependencies: {} }),
      "babel.config.js": `
        const a = x && x && x && x && x && x && x && x;
        const b = y || y || y || y || y || y || y || y;
        const c = z ?? z ?? z ?? z ?? z ?? z ?? z ?? z;
        module.exports = { presets: [a, b, c] };
      `,
    });

    expect(() => detectReactCompiler(projectDirectory, {})).not.toThrow();
  });

  it("handles nested type assertions without stack overflow", () => {
    const projectDirectory = setupProject("nested-type-assertions", {
      "package.json": writePkg({ name: "test", version: "1.0.0", dependencies: {} }),
      "vite.config.ts": `
        const config = (((value as any) as unknown) as string) as any;
        export default { plugins: [config] };
      `,
    });

    expect(() => detectReactCompiler(projectDirectory, {})).not.toThrow();
  });
});
